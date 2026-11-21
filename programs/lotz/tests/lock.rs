//! The lock: epochs, release, and every other way out of the lock vault failing.
mod common;

use anchor_lang::{prelude::Pubkey, solana_program::instruction::AccountMeta};
use common::*;
use lotz::{error::LotzError, events::EpochReleased};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn env_with_two_epochs() -> (Env, Keypair) {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 2, 2)); // epoch 0: 4 lots
    env.advance(WEEK);
    assert_ok(env.try_buy(&bob, 0, 0, 2, 1)); // epoch 1: 2 takeovers -> 1x locked
    (env, alice)
}

#[test]
fn release_before_and_after_unlock() {
    let (mut env, _) = env_with_two_epochs();
    let cranker = env.wallet();
    assert_eq!(env.lock_epoch(0).amount, 4 * BASE_PRICE);
    assert_eq!(env.lock_epoch(1).amount, BASE_PRICE);
    let unlock0 = START + WEEK + YEAR;
    assert_eq!(env.lock_epoch(0).unlock_at, unlock0);

    // before
    assert_lotz_err(env.try_release(&cranker, 0), LotzError::StillLocked);
    env.set_time(unlock0 - 1);
    assert_lotz_err(env.try_release(&cranker, 0), LotzError::StillLocked);

    // at unlock_at, anyone can crank; the treasury's ATA is created and receives the epoch
    env.set_time(unlock0);
    let treasury = env.treasury.pubkey();
    assert!(!env.exists(&env.ata(&treasury)));
    let meta = assert_ok(env.try_release(&cranker, 0));
    assert_eq!(env.tokens(&treasury), 4 * BASE_PRICE);
    assert_eq!(env.lock_balance(), BASE_PRICE);
    let e = env.lock_epoch(0);
    assert!(e.released);
    let c = env.config();
    assert_eq!(c.total_released, 4 * BASE_PRICE);
    assert_eq!(c.total_locked, 5 * BASE_PRICE);
    let ev: EpochReleased = one_event(&meta);
    assert_eq!(
        (ev.epoch, ev.amount, ev.treasury, ev.total_released),
        (0, 4 * BASE_PRICE, treasury, 4 * BASE_PRICE)
    );

    // twice
    assert_lotz_err(env.try_release(&cranker, 0), LotzError::AlreadyReleased);
    // epoch 1 is a week later
    assert_lotz_err(env.try_release(&cranker, 1), LotzError::StillLocked);
    env.advance(WEEK);
    assert_ok(env.try_release(&cranker, 1));
    assert_eq!(env.tokens(&treasury), 5 * BASE_PRICE);
    assert_eq!(env.lock_balance(), 0);
}

#[test]
fn an_epoch_with_no_payments_does_not_exist() {
    let (mut env, _) = env_with_two_epochs();
    env.advance(10 * YEAR);
    let cranker = env.wallet();
    // no account at epoch 7: Anchor refuses the uninitialised account
    assert_anchor_err(env.try_release(&cranker, 7), anchor_lang::error::ErrorCode::AccountNotInitialized);
}

#[test]
fn release_goes_only_to_the_treasury() {
    let (mut env, _) = env_with_two_epochs();
    env.advance(2 * YEAR);
    let thief = env.funded(0);
    let thief_ata = env.ata(&thief.pubkey());

    // treasury replaced by the thief
    let mut ix = env.release_ix(&thief.pubkey(), 0);
    ix.accounts[5].pubkey = thief.pubkey();
    ix.accounts[6].pubkey = thief_ata;
    assert_lotz_err(env.send(&[ix], &[&thief]), LotzError::WrongTreasury);

    // real treasury, the thief's token account as destination
    let mut ix = env.release_ix(&thief.pubkey(), 0);
    ix.accounts[6].pubkey = thief_ata;
    assert_fails(env.send(&[ix], &[&thief]));

    // real treasury, the refund vault as destination
    let mut ix = env.release_ix(&thief.pubkey(), 0);
    ix.accounts[6].pubkey = refund_vault();
    assert_fails(env.send(&[ix], &[&thief]));

    assert_eq!(env.lock_balance(), 5 * BASE_PRICE);
    assert_eq!(env.tokens(&thief.pubkey()), 0);
}

#[test]
fn fake_epoch_accounts_are_refused() {
    let (mut env, _) = env_with_two_epochs();
    env.advance(WEEK + YEAR); // epoch 0 unlocked, epoch 1 not
    let cranker = env.wallet();
    // epoch 1's account under the epoch-0 argument
    let mut ix = env.release_ix(&cranker.pubkey(), 0);
    ix.accounts[3].pubkey = epoch_pda(1);
    assert_anchor_err(env.send(&[ix], &[&cranker]), anchor_lang::error::ErrorCode::ConstraintSeeds);
    // the epoch-0 account under the epoch-1 argument
    let mut ix = env.release_ix(&cranker.pubkey(), 1);
    ix.accounts[3].pubkey = epoch_pda(0);
    assert_anchor_err(env.send(&[ix], &[&cranker]), anchor_lang::error::ErrorCode::ConstraintSeeds);
    assert_eq!(env.lock_balance(), 5 * BASE_PRICE);
}

#[test]
fn no_other_way_out_of_the_lock_vault() {
    let (mut env, alice) = env_with_two_epochs();
    let lock = lock_vault();
    let start = env.lock_balance();
    let thief = env.funded(0);
    let thief_ata = env.ata(&thief.pubkey());

    // 1. claim_refund with the lock vault in place of the refund vault (Alice has a refund due)
    assert!(env.ad_by_id(1).refund_due > 0);
    let mut ix = env.claim_ix(&alice.pubkey(), &env.ads[&1]);
    ix.accounts[4].pubkey = lock;
    assert_anchor_err(env.send(&[ix], &[&alice]), anchor_lang::error::ErrorCode::ConstraintSeeds);

    // 2. a plain token transfer out of the lock vault: its authority is the config PDA, which nobody can sign for
    let transfer = spl_token_2022_interface::instruction::transfer_checked(
        &env.token_program,
        &lock,
        &env.mint,
        &thief_ata,
        &config_pda(),
        &[],
        start,
        DECIMALS,
    )
    .unwrap();
    let mut tx_ix = transfer.clone();
    for meta in tx_ix.accounts.iter_mut() {
        meta.is_signer = false;
    }
    assert_fails(env.send(&[tx_ix], &[]));
    // ... nor can the admin
    let admin = env.admin.insecure_clone();
    let transfer_by_admin = spl_token_2022_interface::instruction::transfer_checked(
        &env.token_program,
        &lock,
        &env.mint,
        &thief_ata,
        &admin.pubkey(),
        &[],
        1,
        DECIMALS,
    )
    .unwrap();
    assert_fails(env.send(&[transfer_by_admin], &[&admin]));

    // 3. buy with the lock vault as the buyer's token account
    let mut args = env.args(20, 20, 1, 1);
    args.max_total = u64::MAX;
    let mut ix = env.buy_ix(&thief.pubkey(), &args);
    ix.accounts[3].pubkey = lock;
    assert_fails(env.send(&[ix], &[&thief]));

    // 4. buy with the lock vault as the refund vault (refunds would then come out of... nowhere; still refused)
    let bob = env.funded(1_000_000 * TOKEN);
    let args = env.args(1, 1, 1, 1);
    let mut ix = env.buy_ix(&bob.pubkey(), &args);
    ix.accounts[5].pubkey = lock;
    // Anchor refuses the same mutable account twice before the seeds are even checked
    assert_anchor_err(
        env.send(&[ix], &[&bob]),
        anchor_lang::error::ErrorCode::ConstraintDuplicateMutableAccount,
    );

    // 5. release with the lock vault as the destination, after unlock
    env.advance(2 * YEAR);
    let mut ix = env.release_ix(&thief.pubkey(), 0);
    ix.accounts[6].pubkey = lock;
    assert_fails(env.send(&[ix], &[&thief]));

    // 6. a forged LockEpoch: an account the thief owns with the right bytes is not owned by the program
    let fake = Keypair::new();
    let real = env.svm.get_account(&epoch_pda(0)).unwrap();
    let mut forged = real.clone();
    forged.owner = Pubkey::new_unique();
    env.svm.set_account(fake.pubkey(), forged).unwrap();
    let mut ix = env.release_ix(&thief.pubkey(), 0);
    ix.accounts[3].pubkey = fake.pubkey();
    assert_fails(env.send(&[ix], &[&thief]));

    // 7. set_paused and close_ad take no vault at all; passing one as an extra account changes nothing
    let mut ix = env.set_paused_ix(&admin.pubkey(), true);
    ix.accounts.push(AccountMeta::new(lock, false));
    ix.accounts.push(AccountMeta::new(thief_ata, false));
    assert_ok(env.send(&[ix], &[&admin]));

    assert_eq!(env.lock_balance(), start, "nothing left the lock vault");
    assert_eq!(env.tokens(&thief.pubkey()), 0);
}

#[test]
fn the_lock_holds_the_full_board_price_until_releases() {
    let mut env = Env::new();
    let wallets: Vec<_> = (0..5).map(|_| env.funded(100_000_000 * TOKEN)).collect();
    let rects = [(0, 0, 5, 5), (3, 3, 5, 5), (0, 0, 10, 10), (8, 8, 4, 4), (2, 2, 3, 9), (9, 0, 2, 2)];
    for (i, (x, y, w, h)) in rects.into_iter().enumerate() {
        let buyer = &wallets[i % wallets.len()];
        let q = env.quote(x, y, w, h);
        let owners_mine = env.prior_ads(x, y, w, h).iter().any(|ad| env.ad(ad).owner == buyer.pubkey());
        if owners_mine {
            continue;
        }
        assert_ok(env.try_buy(buyer, x, y, w, h));
        assert!(q.total > 0);
        let sum: u64 = (0..100u8).flat_map(|i| env.shard(i).lots).map(|l| l.last_price).sum();
        assert_eq!(env.lock_balance(), sum);
        assert_eq!(env.config().total_locked, sum);
    }
}
