//! claim_refund and close_ad.
mod common;

use common::*;
use lotz::{
    error::LotzError,
    events::{AdClosed, RefundClaimed},
};
use solana_signer::Signer;

#[test]
fn claim_pays_the_owner_once() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 3, 1));
    assert_ok(env.try_buy(&bob, 0, 0, 2, 1));

    assert_lotz_err(env.try_claim(&bob, 2), LotzError::NothingToClaim);

    let before = env.tokens(&alice.pubkey());
    let meta = assert_ok(env.try_claim(&alice, 1));
    assert_eq!(env.tokens(&alice.pubkey()) - before, 2 * BASE_PRICE);
    let ev: RefundClaimed = one_event(&meta);
    assert_eq!(ev.ad_id, 1);
    assert_eq!(ev.owner, alice.pubkey());
    assert_eq!(ev.amount, 2 * BASE_PRICE);
    assert_eq!(env.ad_by_id(1).refund_due, 0);

    assert_lotz_err(env.try_claim(&alice, 1), LotzError::NothingToClaim);

    // more refunds accumulate after a claim
    let carol = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&carol, 2, 0, 1, 1));
    assert_eq!(env.ad_by_id(1).refund_due, BASE_PRICE);
    assert_ok(env.try_claim(&alice, 1));
    assert_eq!(env.refund_balance(), 0);
}

#[test]
fn only_the_owner_can_claim() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 1, 1));
    assert_ok(env.try_buy(&bob, 0, 0, 1, 1));
    // Bob signs a claim for Alice's ad to his own ATA
    let ix = env.claim_ix(&bob.pubkey(), &env.ads[&1]);
    assert_lotz_err(env.send(&[ix], &[&bob]), LotzError::NotAdOwner);
    // Bob signs, but the destination is Alice's ATA: still not the owner
    let mut ix = env.claim_ix(&bob.pubkey(), &env.ads[&1]);
    ix.accounts[5].pubkey = env.ata(&alice.pubkey());
    assert_fails(env.send(&[ix], &[&bob]));
    assert_eq!(env.refund_balance(), BASE_PRICE);
}

#[test]
fn claim_creates_the_owner_ata_if_missing() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 1, 1));
    assert_ok(env.try_buy(&bob, 0, 0, 1, 1));
    // Alice empties and closes her ATA
    let alice_ata = env.ata(&alice.pubkey());
    let rest = env.tokens(&alice.pubkey());
    let sink = env.create_ata(&env.treasury.pubkey());
    let transfer = spl_token_2022_interface::instruction::transfer_checked(
        &env.token_program,
        &alice_ata,
        &env.mint,
        &sink,
        &alice.pubkey(),
        &[],
        rest,
        DECIMALS,
    )
    .unwrap();
    let close = spl_token_2022_interface::instruction::close_account(
        &env.token_program,
        &alice_ata,
        &alice.pubkey(),
        &alice.pubkey(),
        &[],
    )
    .unwrap();
    assert_ok(env.send(&[transfer, close], &[&alice]));
    assert!(!env.exists(&alice_ata));

    assert_ok(env.try_claim(&alice, 1));
    assert_eq!(env.tokens(&alice.pubkey()), BASE_PRICE);
}

#[test]
fn close_only_when_empty() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 2, 1));
    assert_lotz_err(env.try_close(&alice, 1), LotzError::AdNotEmpty);

    // one lot left
    assert_ok(env.try_buy(&bob, 0, 0, 1, 1));
    assert_lotz_err(env.try_close(&alice, 1), LotzError::AdNotEmpty);

    // no lots left, refund unclaimed
    assert_ok(env.try_buy(&bob, 1, 0, 1, 1));
    assert_eq!(env.ad_by_id(1).lots_alive, 0);
    assert_lotz_err(env.try_close(&alice, 1), LotzError::AdNotEmpty);

    // not the owner
    assert_ok(env.try_claim(&alice, 1));
    let ix = env.close_ix(&bob.pubkey(), &env.ads[&1]);
    assert_lotz_err(env.send(&[ix], &[&bob]), LotzError::NotAdOwner);

    // empty: closes, rent back to Alice
    let ad = env.ads[&1];
    let rent = env.lamports(&ad);
    let before = env.lamports(&alice.pubkey());
    let meta = assert_ok(env.try_close(&alice, 1));
    assert!(!env.exists(&ad));
    assert_eq!(env.lamports(&alice.pubkey()) - before, rent);
    let ev: AdClosed = one_event(&meta);
    assert_eq!(ev.ad_id, 1);
}

#[test]
fn closed_ad_address_can_be_reused_without_clashing_ids() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    let args = env.args(0, 0, 1, 1);
    assert_ok(env.try_buy_args(&alice, &args));
    assert_ok(env.try_buy(&bob, 0, 0, 1, 1));
    assert_ok(env.try_claim(&alice, 1));
    assert_ok(env.try_close(&alice, 1));
    // Same nonce again: the address is free, the new ad gets a fresh id.
    let mut again = args.clone();
    again.x = 7;
    assert_ok(env.try_buy_args(&alice, &again));
    assert_eq!(env.ad_by_id(3).ad_id, 3);
    assert_eq!(env.lot(7, 0).ad_id, 3);
}
