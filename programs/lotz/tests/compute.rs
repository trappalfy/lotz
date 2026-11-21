//! Compute units of the heaviest purchases. The client sets its compute-unit limit from these numbers.
mod common;

use common::*;
use solana_signer::Signer;

fn long_content(args: &mut lotz::BuyArgs) {
    args.image_uri = format!("https://{}", "u".repeat(192));
    args.link = format!("https://{}", "l".repeat(192));
    args.title = "\u{1F7E9}".repeat(64);
}

/// 16 one-lot ads, then a 10x10 rectangle over 4 shards that takes all 16 and buys 84 free lots,
/// with the longest content the program accepts.
fn worst_case(kind: MintKind) -> u64 {
    let mut env = Env::with(kind, default_params());
    let owners: Vec<_> = (0..16).map(|_| env.funded(1_000_000 * TOKEN)).collect();
    for (i, o) in owners.iter().enumerate() {
        // spread over the 4 shards the big rectangle touches (lots 5..15 x 5..15)
        let (x, y) = (5 + (i % 4) as u8 * 3, 5 + (i / 4) as u8 * 3);
        let mut args = env.args(x, y, 1, 1);
        long_content(&mut args);
        assert_ok(env.try_buy_args(o, &args));
    }
    let taker = env.funded(100_000_000 * TOKEN);
    assert_eq!(env.prior_ads(5, 5, 10, 10).len(), 16);
    let mut args = env.args(5, 5, 10, 10);
    long_content(&mut args);
    let meta = assert_ok(env.try_buy_args(&taker, &args));
    assert_eq!(env.ad_by_id(17).lots_alive, 100);
    meta.compute_units_consumed
}

#[test]
fn worst_case_buy_fits_the_budget() {
    let spl = worst_case(MintKind::Spl);
    let t22 = worst_case(MintKind::Token2022Metadata);
    println!("worst-case buy: SPL Token {spl} CU, Token-2022 {t22} CU");
    // The client sets its limit from a simulation (+15%), falling back to `buyComputeUnits` in the SDK, which
    // must stay above these numbers.
    assert!(spl < 200_000, "{spl}");
    assert!(t22 < 200_000, "{t22}");
}

#[test]
fn simple_buy_cost() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    let meta = assert_ok(env.try_buy(&buyer, 0, 0, 1, 1));
    println!("1-lot buy: {} CU", meta.compute_units_consumed);
    let meta = assert_ok(env.try_buy(&buyer, 10, 10, 10, 10));
    println!("100-lot free buy: {} CU", meta.compute_units_consumed);
    let other = env.funded(1_000_000 * TOKEN);
    let meta = assert_ok(env.try_buy(&other, 0, 0, 1, 1));
    println!("1-lot takeover: {} CU", meta.compute_units_consumed);
    let meta = assert_ok(env.try_claim(&buyer, 1));
    println!("claim_refund: {} CU", meta.compute_units_consumed);
    let meta = assert_ok(env.try_close(&buyer, 1));
    println!("close_ad: {} CU", meta.compute_units_consumed);
    env.advance(WEEK + YEAR);
    let cranker = env.wallet();
    let meta = assert_ok(env.try_release(&cranker, 0));
    println!("release_epoch: {} CU", meta.compute_units_consumed);
    assert_eq!(env.lock_balance(), 0, "every payment was in epoch 0");
    assert_eq!(env.tokens(&buyer.pubkey()), 1_000_000 * TOKEN - 100 * BASE_PRICE);
}
