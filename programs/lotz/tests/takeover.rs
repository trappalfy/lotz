//! Takeovers: price, refund accounting, mixed rectangles, holes, own lots, prior-ad accounts.
mod common;

use common::*;
use lotz::{error::LotzError, events::LotsBought};
use solana_signer::Signer;

#[test]
fn takeover_pays_1_5x_and_refunds_the_previous_owner() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 2, 2));
    let lock_after_alice = env.lock_balance();

    let bob_before = env.tokens(&bob.pubkey());
    let meta = assert_ok(env.try_buy(&bob, 0, 0, 2, 2));

    let price = BASE_PRICE * 3 / 2;
    assert_eq!(env.tokens(&bob.pubkey()), bob_before - 4 * price);
    // the previous owner's full price goes to the refund vault, half of it again to the lock
    assert_eq!(env.refund_balance(), 4 * BASE_PRICE);
    assert_eq!(env.lock_balance() - lock_after_alice, 4 * BASE_PRICE / 2);

    let alice_ad = env.ad_by_id(1);
    assert_eq!(alice_ad.lots_alive, 0);
    assert_eq!(alice_ad.refund_due, 4 * BASE_PRICE);
    let bob_ad = env.ad_by_id(2);
    assert_eq!(bob_ad.lots_alive, 4);
    assert_eq!(bob_ad.paid_total, 4 * price);
    assert_eq!(env.lot(0, 0).ad_id, 2);
    assert_eq!(env.lot(0, 0).last_price, price);

    let c = env.config();
    assert_eq!(c.lots_sold, 4, "a taken lot is not sold again");
    assert_eq!(c.takeovers, 4);

    let ev: LotsBought = one_event(&meta);
    assert_eq!((ev.free_lots, ev.taken_lots), (0, 4));
    assert_eq!(ev.paid_total, 4 * price);
    assert_eq!(ev.refunded, 4 * BASE_PRICE);
    assert_eq!(ev.locked, 2 * BASE_PRICE);
    assert_eq!(ev.prior.len(), 1);
    assert_eq!(ev.prior[0].ad_id, 1);
    assert_eq!(ev.prior[0].lots, 4);
    assert_eq!(ev.prior[0].refund, 4 * BASE_PRICE);

    // Alice claims: every token she paid comes back.
    let alice_before = env.tokens(&alice.pubkey());
    assert_ok(env.try_claim(&alice, 1));
    assert_eq!(env.tokens(&alice.pubkey()) - alice_before, 4 * BASE_PRICE);
    assert_eq!(env.refund_balance(), 0);
}

#[test]
fn mixed_rectangle_and_holes() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    let carol = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 3, 3)); // ad 1: 9 lots
    assert_ok(env.try_buy(&bob, 3, 0, 2, 2)); // ad 2: 4 lots

    // Carol buys 2..6 x 1..3: 2 of Alice's, 2 of Bob's, 4 free.
    let q = env.quote(2, 1, 4, 2);
    assert_eq!((q.free_lots, q.taken_lots), (4, 4));
    let expected = 4 * BASE_PRICE + 4 * (BASE_PRICE * 3 / 2);
    assert_eq!(q.total, expected);

    let lock_before = env.lock_balance();
    let meta = assert_ok(env.try_buy(&carol, 2, 1, 4, 2));
    let ev: LotsBought = one_event(&meta);
    assert_eq!(ev.paid_total, expected);
    assert_eq!(ev.refunded, 4 * BASE_PRICE);
    assert_eq!(ev.locked, 4 * BASE_PRICE + 2 * BASE_PRICE);
    assert_eq!(env.lock_balance() - lock_before, ev.locked);
    assert_eq!(ev.prior.len(), 2);

    // Alice's ad now has a hole of 2 lots; Bob's lost its bottom row.
    assert_eq!(env.ad_by_id(1).lots_alive, 7);
    assert_eq!(env.ad_by_id(1).refund_due, 2 * BASE_PRICE);
    assert_eq!(env.ad_by_id(2).lots_alive, 2);
    assert_eq!(env.ad_by_id(2).refund_due, 2 * BASE_PRICE);
    assert_eq!(env.lot(2, 1).ad_id, 3);
    assert_eq!(env.lot(1, 1).ad_id, 1);
    assert_eq!(env.lot(3, 0).ad_id, 2);
    assert_eq!(env.lot(5, 2).ad_id, 3);
    assert_eq!(env.config().lots_sold, 13 + 4);
}

#[test]
fn repeated_takeovers_follow_the_ladder() {
    let mut env = Env::new();
    let wallets: Vec<_> = (0..7).map(|_| env.funded(1_000_000 * TOKEN)).collect();
    let mut expected = BASE_PRICE;
    for (i, w) in wallets.iter().enumerate() {
        assert_ok(env.try_buy(w, 50, 50, 1, 1));
        assert_eq!(env.lot(50, 50).last_price, expected, "after {i} takeovers");
        // The lock holds exactly the lot's current price (brief §2.6).
        assert_eq!(env.lock_balance(), expected);
        expected = lotz::math::takeover_price(expected, 15_000).unwrap();
    }
    // 1x -> 1.5x -> 2.25x -> 3.375x -> 5.0625x -> 7.59375x -> 11.390625x
    assert_eq!(env.lot(50, 50).last_price, BASE_PRICE * 11_390_625 / 1_000_000);
    // every displaced owner gets back exactly what they paid
    for (i, w) in wallets.iter().enumerate().take(6) {
        let ad_id = i as u64 + 1;
        assert_eq!(env.ad_by_id(ad_id).refund_due, env.ad_by_id(ad_id).paid_total);
        let before = env.tokens(&w.pubkey());
        assert_ok(env.try_claim(w, ad_id));
        assert_eq!(env.tokens(&w.pubkey()) - before, env.ad_by_id(ad_id).paid_total);
    }
    assert_eq!(env.refund_balance(), 0);
}

#[test]
fn takeover_price_rounds_up() {
    // base price 101 base units: 1.5x = 151.5 -> 152
    let mut env = Env::with(MintKind::Spl, lotz::InitParams { base_price: 101, ..default_params() });
    let a = env.funded(1_000_000);
    let b = env.funded(1_000_000);
    assert_ok(env.try_buy(&a, 0, 0, 1, 1));
    let meta = assert_ok(env.try_buy(&b, 0, 0, 1, 1));
    let ev: LotsBought = one_event(&meta);
    assert_eq!(ev.paid_total, 152);
    assert_eq!(ev.refunded, 101);
    assert_eq!(ev.locked, 51);
    assert_eq!(env.lock_balance(), 152);
}

#[test]
fn cannot_take_your_own_lot() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 2, 2));
    assert_lotz_err(env.try_buy(&alice, 1, 1, 2, 2), LotzError::OwnLot);
    // also through a different ad of hers
    assert_ok(env.try_buy(&alice, 10, 10, 1, 1));
    assert_lotz_err(env.try_buy(&alice, 10, 10, 1, 1), LotzError::OwnLot);
    // her free neighbours are fine
    assert_ok(env.try_buy(&alice, 2, 0, 2, 2));
}

#[test]
fn prior_ads_must_be_passed() {
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    let carol = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 1, 1)); // ad 1
    assert_ok(env.try_buy(&bob, 1, 0, 1, 1)); // ad 2
    assert_ok(env.try_buy(&bob, 5, 5, 1, 1)); // ad 3, not in the rectangle

    let args = env.args(0, 0, 2, 1);
    let pk = carol.pubkey();
    let s = [shard_pda(0)];
    // none
    let ix = env.buy_ix_with(&pk, &args, &s, &[]);
    assert_lotz_err(env.send(&[ix], &[&carol]), LotzError::PriorAdMissing);
    // one missing
    let ix = env.buy_ix_with(&pk, &args, &s, &[env.ads[&1]]);
    assert_lotz_err(env.send(&[ix], &[&carol]), LotzError::PriorAdMissing);
    // a different (real) ad in place of the missing one
    let ix = env.buy_ix_with(&pk, &args, &s, &[env.ads[&1], env.ads[&3]]);
    assert_lotz_err(env.send(&[ix], &[&carol]), LotzError::PriorAdMissing);
    // something that is not an ad
    let ix = env.buy_ix_with(&pk, &args, &s, &[env.ads[&1], env.ads[&2], config_pda()]);
    assert_lotz_err(env.send(&[ix], &[&carol]), LotzError::InvalidPriorAd);
    // read-only ad
    let mut ix = env.buy_ix_with(&pk, &args, &s, &[env.ads[&1], env.ads[&2]]);
    let last = ix.accounts.len() - 1;
    ix.accounts[last].is_writable = false;
    assert_lotz_err(env.send(&[ix], &[&carol]), LotzError::InvalidPriorAd);
    // right, in any order
    let ix = env.buy_ix_with(&pk, &args, &s, &[env.ads[&2], env.ads[&1]]);
    assert_ok(env.send(&[ix], &[&carol]));
    assert_eq!(env.ad_by_id(1).lots_alive, 0);
    assert_eq!(env.ad_by_id(2).lots_alive, 0);
    assert_eq!(env.ad_by_id(3).lots_alive, 1);
}

#[test]
fn at_most_16_prior_ads_per_purchase() {
    let mut env = Env::new();
    let owners: Vec<_> = (0..17).map(|_| env.funded(1_000_000 * TOKEN)).collect();
    // 17 one-lot ads in a row of a 10x2 rectangle
    for (i, o) in owners.iter().enumerate() {
        let (x, y) = ((i % 10) as u8, (i / 10) as u8);
        assert_ok(env.try_buy(o, x, y, 1, 1));
    }
    let taker = env.funded(10_000_000 * TOKEN);
    assert_lotz_err(env.try_buy(&taker, 0, 0, 10, 2), LotzError::TooManyPriorAds);
    // 16 is fine (10 + 6)
    assert_ok(env.try_buy(&taker, 0, 0, 10, 1));
    let taker2 = env.funded(10_000_000 * TOKEN);
    assert_ok(env.try_buy(&taker2, 0, 0, 10, 2)); // 1 prior ad (the taker's) + 7 one-lot ads
}

#[test]
fn chain_of_takeovers_across_ads() {
    // Alice's ad loses lots to Bob, Bob's lots (some of them former Alice lots) go to Carol.
    let mut env = Env::new();
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);
    let carol = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&alice, 0, 0, 4, 1)); // ad 1 at 1x
    assert_ok(env.try_buy(&bob, 2, 0, 4, 1)); // ad 2: 2 lots at 1.5x (from Alice) + 2 free at 1x
    assert_ok(env.try_buy(&carol, 1, 0, 4, 1)); // ad 3: 1 from Alice (1.5x), 2 from Bob at 2.25x, 1 from Bob at 1.5x

    let p1 = BASE_PRICE;
    let p15 = BASE_PRICE * 3 / 2;
    let p225 = BASE_PRICE * 9 / 4;
    assert_eq!(env.ad_by_id(1).lots_alive, 1);
    assert_eq!(env.ad_by_id(1).refund_due, 3 * p1);
    assert_eq!(env.ad_by_id(2).lots_alive, 1);
    assert_eq!(env.ad_by_id(2).refund_due, 2 * p15 + p1);
    assert_eq!(env.ad_by_id(3).paid_total, p15 + 2 * p225 + p15);
    // the lock holds the sum of the current prices of all sold lots
    let current: u64 = (0..6u16).map(|lx| env.lot(lx, 0).last_price).sum();
    assert_eq!(env.lock_balance(), current);
    assert_eq!(env.refund_balance(), 3 * p1 + 2 * p15 + p1);
}
