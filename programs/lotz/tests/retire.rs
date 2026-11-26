//! Retiring the board: every owner gets their refund and their ad rent back first, then the admin gets the rest of
//! the rent; no locked token can move; every step is guarded.
mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use lotz::{
    error::LotzError,
    events::{ConfigClosed, Retired},
};
use solana_keypair::Keypair;
use solana_signer::Signer;

struct Board {
    env: Env,
    alice: Keypair,
    bob: Keypair,
    carol: Keypair,
    /// Alice's, Bob's and Carol's ad ids.
    ids: [u64; 3],
}

/// Alice buys 2x2; a week later Bob takes one of her lots (she is owed a refund) and Carol buys elsewhere.
fn board_with(kind: MintKind) -> Board {
    let mut env = Env::with(kind, default_params());
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    let carol = env.funded(1_000_000 * TOKEN);
    let a = env.buy(&alice, 0, 0, 2, 2);
    env.advance(WEEK);
    let b = env.buy(&bob, 1, 1, 2, 2);
    let c = env.buy(&carol, 50, 50, 3, 1);
    assert!(env.ad_by_id(a).refund_due > 0);
    Board { env, alice, bob, carol, ids: [a, b, c] }
}

fn board() -> Board {
    board_with(MintKind::Spl)
}

fn all_shards() -> Vec<Pubkey> {
    (0..100u8).map(shard_pda).collect()
}

fn retire(env: &mut Env) -> Retired {
    let admin = env.admin.insecure_clone();
    assert_ok(env.try_set_paused(&admin, true));
    let ix = env.retire_ix(&admin.pubkey());
    one_event(&assert_ok(env.send(&[ix], &[&admin])))
}

/// Anyone pays out every refund and closes every ad; each owner gets exactly their refund and their ad's rent.
fn pay_and_close_ads(b: &mut Board) {
    let caller = b.env.wallet();
    let owed = b.env.ad_by_id(b.ids[0]).refund_due;
    let before = b.env.tokens(&b.alice.pubkey());
    let ix = b.env.claim_for_ix(&caller.pubkey(), &b.alice.pubkey(), &b.env.ads[&b.ids[0]]);
    assert_ok(b.env.send(&[ix], &[&caller]));
    assert_eq!(b.env.tokens(&b.alice.pubkey()), before + owed);
    for (id, owner) in [(b.ids[0], b.alice.pubkey()), (b.ids[1], b.bob.pubkey()), (b.ids[2], b.carol.pubkey())] {
        let ad = b.env.ads[&id];
        let rent = b.env.lamports(&ad);
        let before = b.env.lamports(&owner);
        let ix = b.env.close_for_ix(&caller.pubkey(), &owner, &ad);
        assert_ok(b.env.send(&[ix], &[&caller]));
        assert_eq!(b.env.lamports(&owner), before + rent, "ad {id}: rent goes to its owner");
        assert!(!b.env.exists(&ad));
    }
    assert_eq!(b.env.config().ads_open, 0);
}

fn retire_shards(env: &mut Env) {
    let admin = env.admin.insecure_clone();
    for chunk in all_shards().chunks(20) {
        let ix = env.retire_shards_ix(&admin.pubkey(), chunk);
        assert_ok(env.send(&[ix], &[&admin]));
    }
    assert_eq!(env.config().shards_open, 0);
}

fn retire_config(env: &mut Env) -> ConfigClosed {
    let admin = env.admin.insecure_clone();
    let ix = env.retire_config_ix(&admin.pubkey());
    one_event(&assert_ok(env.send(&[ix], &[&admin])))
}

fn full_wind_down(kind: MintKind) {
    let mut b = board_with(kind);
    let admin = b.env.admin.pubkey();
    let cranker = b.env.wallet();
    // a year after the last week with payments, every epoch is released to the treasury
    b.env.advance(YEAR + 2 * WEEK);
    for e in [0, 1] {
        assert_ok(b.env.try_release(&cranker, e));
    }
    assert_eq!(b.env.lock_balance(), 0);
    let total_locked = b.env.config().total_locked;

    // the rent the admin should get back: config, both vaults, 100 shards, the epoch records
    let mut rent = b.env.lamports(&config_pda()) + b.env.lamports(&lock_vault()) + b.env.lamports(&refund_vault());
    for a in all_shards().into_iter().chain([epoch_pda(0), epoch_pda(1)]) {
        rent += b.env.lamports(&a);
    }
    let admin_before = b.env.lamports(&admin);

    let ev = retire(&mut b.env);
    assert_eq!((ev.locked_left, ev.ads_open), (0, 3));
    pay_and_close_ads(&mut b);
    let admin_kp = b.env.admin.insecure_clone();
    for e in [0, 1] {
        let ix = b.env.retire_epoch_ix(&admin, e);
        assert_ok(b.env.send(&[ix], &[&admin_kp]));
    }
    retire_shards(&mut b.env);
    let ev = retire_config(&mut b.env);
    assert_eq!((ev.locked_left, ev.refund_left), (0, 0));

    // every lamport of rent is back with the admin (fees are paid by another wallet here), nothing is left open
    assert_eq!(b.env.lamports(&admin), admin_before + rent);
    for a in [config_pda(), lock_vault(), refund_vault(), epoch_pda(0), epoch_pda(1)].into_iter().chain(all_shards()) {
        assert!(!b.env.exists(&a), "{a} is still open");
    }
    // and the treasury got every locked token
    assert_eq!(b.env.tokens(&b.env.treasury.pubkey()), total_locked);
}

#[test]
fn full_wind_down_returns_all_rent() {
    full_wind_down(MintKind::Spl);
}

#[test]
fn full_wind_down_with_token_2022() {
    full_wind_down(MintKind::Token2022Metadata);
}

#[test]
fn retiring_early_leaves_locked_tokens_in_the_lock_for_good() {
    let mut b = board();
    let locked = b.env.lock_balance();
    assert!(locked > 0);
    let ev = retire(&mut b.env);
    assert_eq!(ev.locked_left, locked);
    pay_and_close_ads(&mut b);

    // an epoch that was not released keeps its record
    let admin = b.env.admin.insecure_clone();
    let ix = b.env.retire_epoch_ix(&admin.pubkey(), 0);
    assert_lotz_err(b.env.send(&[ix], &[&admin]), LotzError::StillLocked);

    retire_shards(&mut b.env);
    let ev = retire_config(&mut b.env);
    assert_eq!((ev.locked_left, ev.refund_left), (locked, 0));
    assert!(!b.env.exists(&config_pda()));
    assert!(!b.env.exists(&refund_vault()));
    // the lock vault stays, with every token in it, and nothing can take them out any more
    assert!(b.env.exists(&lock_vault()));
    assert_eq!(b.env.lock_balance(), locked);
    b.env.advance(2 * YEAR);
    let cranker = b.env.wallet();
    assert_fails(b.env.try_release(&cranker, 0));
    assert_eq!(b.env.lock_balance(), locked);
}

#[test]
fn nothing_closes_before_the_board_is_retired() {
    let mut b = board();
    let admin = b.env.admin.insecure_clone();
    let stranger = b.env.wallet();
    let (ad0, ad2) = (b.env.ads[&b.ids[0]], b.env.ads[&b.ids[2]]);

    // nobody but the owner claims or closes an ad
    let ix = b.env.claim_for_ix(&stranger.pubkey(), &b.alice.pubkey(), &ad0);
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::NotAdOwner);
    let ix = b.env.close_for_ix(&stranger.pubkey(), &b.carol.pubkey(), &ad2);
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::NotAdOwner);
    // and the owner only once nothing is alive on it
    let ix = b.env.close_for_ix(&b.carol.pubkey(), &b.carol.pubkey(), &ad2);
    let carol = b.carol.insecure_clone();
    assert_lotz_err(b.env.send(&[ix], &[&carol]), LotzError::AdNotEmpty);

    // the retirement steps refuse
    let released_soon = b.env.retire_epoch_ix(&admin.pubkey(), 0);
    assert_lotz_err(b.env.send(&[released_soon], &[&admin]), LotzError::NotRetired);
    let ix = b.env.retire_shards_ix(&admin.pubkey(), &all_shards()[..5]);
    assert_lotz_err(b.env.send(&[ix], &[&admin]), LotzError::NotRetired);
    let ix = b.env.retire_config_ix(&admin.pubkey());
    assert_lotz_err(b.env.send(&[ix], &[&admin]), LotzError::NotRetired);

    // retiring takes the admin, and buying paused first
    let ix = b.env.retire_ix(&stranger.pubkey());
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::NotAdmin);
    let ix = b.env.retire_ix(&admin.pubkey());
    assert_lotz_err(b.env.send(&[ix], &[&admin]), LotzError::NotPaused);
}

#[test]
fn a_retired_board_stays_closed_and_checks_every_account() {
    let mut b = board();
    let admin = b.env.admin.insecure_clone();
    let stranger = b.env.funded(10 * TOKEN);
    retire(&mut b.env);

    // for good: no resuming, no buying, no retiring twice
    assert_lotz_err(b.env.try_set_paused(&admin, false), LotzError::Retired);
    let carol = b.carol.insecure_clone();
    assert_lotz_err(b.env.try_buy(&carol, 80, 80, 1, 1), LotzError::Paused);
    let ix = b.env.retire_ix(&admin.pubkey());
    assert_lotz_err(b.env.send(&[ix], &[&admin]), LotzError::Retired);

    // an ad with a refund owed cannot be closed, and the refund only goes to the owner's own ATA
    let ad0 = b.env.ads[&b.ids[0]];
    let ix = b.env.close_for_ix(&stranger.pubkey(), &b.alice.pubkey(), &ad0);
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::AdNotEmpty);
    let ix = b.env.claim_for_ix(&stranger.pubkey(), &stranger.pubkey(), &ad0);
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::NotAdOwner);
    let mut ix = b.env.claim_for_ix(&stranger.pubkey(), &b.alice.pubkey(), &ad0);
    ix.accounts[6].pubkey = b.env.ata(&stranger.pubkey()); // owner_token
    assert_fails(b.env.send(&[ix], &[&stranger]));
    let ix = b.env.close_for_ix(&stranger.pubkey(), &stranger.pubkey(), &b.env.ads[&b.ids[2]]);
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::NotAdOwner);

    // the config waits for every ad and shard
    let ix = b.env.retire_config_ix(&admin.pubkey());
    assert_lotz_err(b.env.send(&[ix], &[&admin]), LotzError::StillOpen);

    // retire_shards takes shards only, at their own addresses, from the admin only
    let ix = b.env.retire_shards_ix(&stranger.pubkey(), &all_shards()[..2]);
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::NotAdmin);
    for not_a_shard in [config_pda(), b.env.ads[&b.ids[1]], lock_vault()] {
        let ix = b.env.retire_shards_ix(&admin.pubkey(), &[not_a_shard]);
        assert_lotz_err(b.env.send(&[ix], &[&admin]), LotzError::NotAShard);
    }
    let fake = Keypair::new();
    let copy = b.env.svm.get_account(&shard_pda(0)).unwrap();
    b.env.svm.set_account(fake.pubkey(), copy).unwrap();
    let ix = b.env.retire_shards_ix(&admin.pubkey(), &[fake.pubkey()]);
    assert_lotz_err(b.env.send(&[ix], &[&admin]), LotzError::NotAShard);
    let ix = b.env.retire_shards_ix(&admin.pubkey(), &[shard_pda(3), shard_pda(3)]);
    assert_fails(b.env.send(&[ix], &[&admin]));
    assert!(b.env.exists(&shard_pda(3)));
    let ix = b.env.retire_epoch_ix(&stranger.pubkey(), 0);
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::NotAdmin);
    let ix = b.env.retire_config_ix(&stranger.pubkey());
    assert_lotz_err(b.env.send(&[ix], &[&stranger]), LotzError::NotAdmin);

    // a token sent straight to the refund vault cannot block the wind-down: that vault just stays open
    pay_and_close_ads(&mut b);
    retire_shards(&mut b.env);
    let stray = spl_token_2022_interface::instruction::transfer_checked(
        &b.env.token_program,
        &b.env.ata(&stranger.pubkey()),
        &b.env.mint,
        &refund_vault(),
        &stranger.pubkey(),
        &[],
        5,
        DECIMALS,
    )
    .unwrap();
    assert_ok(b.env.send(&[stray], &[&stranger]));
    let locked = b.env.lock_balance();
    let ev = retire_config(&mut b.env);
    assert_eq!((ev.locked_left, ev.refund_left), (locked, 5));
    assert!(!b.env.exists(&config_pda()));
    assert_eq!(b.env.refund_balance(), 5);
}

#[test]
fn ads_open_counts_every_ad() {
    let mut b = board();
    assert_eq!(b.env.config().ads_open, 3);
    // Bob takes all of Carol's lots; she claims her refund and closes her ad
    let bob = b.bob.insecure_clone();
    assert_ok(b.env.try_buy(&bob, 50, 50, 3, 1));
    assert_eq!(b.env.config().ads_open, 4);
    let carol = b.carol.insecure_clone();
    assert_ok(b.env.try_claim(&carol, b.ids[2]));
    assert_ok(b.env.try_close(&carol, b.ids[2]));
    assert_eq!(b.env.config().ads_open, 3);
}
