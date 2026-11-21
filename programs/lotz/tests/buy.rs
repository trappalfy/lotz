//! Buying free lots: price, accounting, tiers, `max_total`, validation, pause.
mod common;

use common::*;
use lotz::{error::LotzError, events::LotsBought, InitParams};
use solana_signer::Signer;

#[test]
fn buy_free_lots() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    let before = env.tokens(&buyer.pubkey());

    let args = env.args(10, 20, 3, 2);
    let meta = assert_ok(env.try_buy_args(&buyer, &args));

    let total = 6 * BASE_PRICE;
    assert_eq!(env.tokens(&buyer.pubkey()), before - total);
    // A free lot's whole price goes to the lock.
    assert_eq!(env.lock_balance(), total);
    assert_eq!(env.refund_balance(), 0);

    let c = env.config();
    assert_eq!(c.lots_sold, 6);
    assert_eq!(c.total_locked, total);
    assert_eq!(c.takeovers, 0);
    assert_eq!(c.next_ad_id, 2);

    let ad = env.ad_by_id(1);
    assert_eq!(ad.ad_id, 1);
    assert_eq!(ad.owner, buyer.pubkey());
    assert_eq!((ad.x, ad.y, ad.w, ad.h), (10, 20, 3, 2));
    assert_eq!(ad.lots_alive, 6);
    assert_eq!(ad.refund_due, 0);
    assert_eq!(ad.paid_total, total);
    assert_eq!(ad.created_at, START);
    assert_eq!(ad.image_hash, [7; 32]);
    assert_eq!(ad.image_uri, args.image_uri);
    assert_eq!(ad.link, "https://example.com/your-coin");
    assert_eq!(ad.title, "your coin");

    for ly in 20..22 {
        for lx in 10..13 {
            let lot = env.lot(lx, ly);
            assert_eq!(lot.ad_id, 1);
            assert_eq!(lot.last_price, BASE_PRICE);
        }
    }
    assert_eq!(env.lot(13, 20).ad_id, 0);
    assert_eq!(env.lot(10, 22).ad_id, 0);

    let epoch = env.lock_epoch(0);
    assert_eq!(epoch.epoch, 0);
    assert_eq!(epoch.amount, total);
    assert_eq!(epoch.unlock_at, START + WEEK + YEAR);
    assert!(!epoch.released);

    let ev: LotsBought = one_event(&meta);
    assert_eq!(ev.ad_id, 1);
    assert_eq!(ev.buyer, buyer.pubkey());
    assert_eq!((ev.x, ev.y, ev.w, ev.h), (10, 20, 3, 2));
    assert_eq!((ev.free_lots, ev.taken_lots), (6, 0));
    assert_eq!(ev.tier, 0);
    assert_eq!(ev.free_lot_price, BASE_PRICE);
    assert_eq!(ev.paid_total, total);
    assert_eq!(ev.locked, total);
    assert_eq!(ev.refunded, 0);
    assert_eq!(ev.epoch, 0);
    assert_eq!(ev.lots_sold, 6);
    assert!(ev.prior.is_empty());
    assert_eq!(ev.title, "your coin");
}

#[test]
fn rectangle_across_four_shards() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    // lots 5..15 x 5..15 touch shards 0, 1, 10, 11
    assert_ok(env.try_buy(&buyer, 5, 5, 10, 10));
    assert_eq!(env.config().lots_sold, 100);
    assert_eq!(env.lot(5, 5).ad_id, 1);
    assert_eq!(env.lot(14, 14).ad_id, 1);
    assert_eq!(env.lot(15, 14).ad_id, 0);
    assert_eq!(env.ad_by_id(1).lots_alive, 100);
    // a corner of the board
    assert_ok(env.try_buy(&buyer, 90, 90, 10, 10));
    assert_eq!(env.lot(99, 99).ad_id, 2);
}

/// Sells `n` lots (a multiple of 100 lots fills whole 10x10 blocks from the top-left, row by row of blocks).
fn sell_blocks(env: &mut Env, buyer: &solana_keypair::Keypair, blocks: u8) {
    for b in 0..blocks {
        assert_ok(env.try_buy(buyer, (b % 10) * 10, (b / 10) * 10, 10, 10));
    }
}

#[test]
fn whole_rectangle_priced_at_the_tier_at_the_start() {
    let mut env = Env::new();
    let buyer = env.funded(u64::MAX / 4);

    // 996 lots sold: still tier 0
    sell_blocks(&mut env, &buyer, 9);
    assert_ok(env.try_buy(&buyer, 90, 0, 10, 9));
    assert_ok(env.try_buy(&buyer, 90, 9, 6, 1));
    assert_eq!(env.config().lots_sold, 996);

    // 8 more lots cross 1,000: all 8 at the tier-0 price (brief §2.3)
    let lock_before = env.lock_balance();
    let meta = assert_ok(env.try_buy(&buyer, 0, 10, 4, 2));
    let ev: LotsBought = one_event(&meta);
    assert_eq!(ev.tier, 0);
    assert_eq!(ev.paid_total, 8 * BASE_PRICE);
    assert_eq!(env.lock_balance() - lock_before, 8 * BASE_PRICE);
    assert_eq!(env.config().lots_sold, 1_004);

    // next purchase: tier 1, 1.25x
    let meta = assert_ok(env.try_buy(&buyer, 10, 10, 1, 1));
    let ev: LotsBought = one_event(&meta);
    assert_eq!(ev.tier, 1);
    assert_eq!(ev.free_lot_price, BASE_PRICE * 5 / 4);
    assert_eq!(ev.paid_total, BASE_PRICE * 5 / 4);
}

#[test]
fn tier_ladder_reaches_about_7_45x() {
    let mut env = Env::new();
    let buyer = env.funded(u64::MAX / 4);
    // Sell 9,000 lots (9 tiers), then price the 10th tier.
    sell_blocks(&mut env, &buyer, 90);
    assert_eq!(env.config().lots_sold, 9_000);
    let meta = assert_ok(env.try_buy(&buyer, 0, 90, 1, 1));
    let ev: LotsBought = one_event(&meta);
    assert_eq!(ev.tier, 9);
    // 1000 tokens * 1.25^9, floored at each step
    assert_eq!(ev.free_lot_price, 7_450_580_595);
}

#[test]
fn a_small_tier_size_that_would_overflow_is_refused() {
    // 100 tiers of 1.25x: the top price does not fit in u64
    let mut env = Env::bare(MintKind::Spl);
    let admin = env.admin.insecure_clone();
    assert_lotz_err(
        env.try_initialize(&admin, InitParams { tier_size: 100, ..default_params() }),
        LotzError::InvalidParams,
    );
    // 100-lot tiers with a gentle multiplier are fine
    assert_ok(
        env.try_initialize(&admin, InitParams { tier_size: 100, tier_mult_bps: 10_100, ..default_params() }),
    );
}

#[test]
fn max_total_protects_the_buyer() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);

    let mut args = env.args(0, 0, 2, 2);
    args.max_total = 4 * BASE_PRICE - 1;
    assert_lotz_err(env.try_buy_args(&buyer, &args), LotzError::SlippageExceeded);
    assert_eq!(env.config().lots_sold, 0);
    assert_eq!(env.lock_balance(), 0);

    args.max_total = 4 * BASE_PRICE;
    assert_ok(env.try_buy_args(&buyer, &args));

    // The price moved (someone else took the lots); the old quote is now too low.
    let other = env.funded(1_000_000 * TOKEN);
    let mut args = env.args(0, 0, 2, 2);
    args.max_total = 4 * BASE_PRICE;
    assert_lotz_err(env.try_buy_args(&other, &args), LotzError::SlippageExceeded);
    args.max_total = 6 * BASE_PRICE;
    assert_ok(env.try_buy_args(&other, &args));
}

#[test]
fn not_enough_tokens_fails() {
    let mut env = Env::new();
    let buyer = env.funded(BASE_PRICE * 4 - 1);
    assert_fails(env.try_buy(&buyer, 0, 0, 2, 2));
    assert_eq!(env.config().lots_sold, 0);
}

#[test]
fn rectangle_bounds_and_size() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    for (x, y, w, h, err) in [
        (0, 0, 0, 1, LotzError::RectTooLarge),
        (0, 0, 1, 0, LotzError::RectTooLarge),
        (0, 0, 11, 1, LotzError::RectTooLarge),
        (0, 0, 1, 11, LotzError::RectTooLarge),
        (95, 0, 6, 1, LotzError::RectOutOfBounds),
        (0, 99, 1, 2, LotzError::RectOutOfBounds),
        (100, 0, 1, 1, LotzError::RectOutOfBounds),
        (250, 250, 10, 10, LotzError::RectOutOfBounds),
    ] {
        let args = env.args(x, y, w, h);
        assert_lotz_err(env.try_buy_args(&buyer, &args), err);
    }
}

#[test]
fn max_rect_comes_from_the_config() {
    let mut env = Env::with(MintKind::Spl, InitParams { max_rect: 4, ..default_params() });
    let buyer = env.funded(1_000_000 * TOKEN);
    assert_lotz_err(env.try_buy(&buyer, 0, 0, 5, 1), LotzError::RectTooLarge);
    assert_ok(env.try_buy(&buyer, 0, 0, 4, 4));
}

type Mutation = Box<dyn Fn(&mut lotz::BuyArgs)>;

#[test]
fn content_is_validated() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    let cases: Vec<(Mutation, LotzError)> = vec![
        (Box::new(|a| a.image_hash = [0; 32]), LotzError::MissingImageHash),
        (Box::new(|a| a.image_uri = String::new()), LotzError::InvalidImageUri),
        (Box::new(|a| a.image_uri = "x".repeat(201)), LotzError::InvalidImageUri),
        (Box::new(|a| a.image_uri = "https://cdn/a b.png".into()), LotzError::InvalidImageUri),
        (Box::new(|a| a.link = "http://example.com".into()), LotzError::InvalidLink),
        (Box::new(|a| a.link = "javascript:alert(1)".into()), LotzError::InvalidLink),
        (Box::new(|a| a.link = "https://".into()), LotzError::InvalidLink),
        (Box::new(|a| a.link = format!("https://{}", "a".repeat(193))), LotzError::InvalidLink),
        (Box::new(|a| a.link = "https://exa mple.com".into()), LotzError::InvalidLink),
        (Box::new(|a| a.link = "https://example.com/\u{e9}".into()), LotzError::InvalidLink),
        (Box::new(|a| a.title = "a".repeat(65)), LotzError::InvalidTitle),
        (Box::new(|a| a.title = "line\nbreak".into()), LotzError::InvalidTitle),
    ];
    for (mutate, err) in cases {
        let mut args = env.args(0, 0, 1, 1);
        mutate(&mut args);
        assert_lotz_err(env.try_buy_args(&buyer, &args), err);
    }

    // limits are inclusive; titles count characters, not bytes
    let mut args = env.args(0, 0, 1, 1);
    args.link = format!("https://{}", "a".repeat(192));
    args.image_uri = "u".repeat(200);
    args.title = "\u{1F7E9}".repeat(64);
    assert_ok(env.try_buy_args(&buyer, &args));
    assert_eq!(env.ad_by_id(1).title.chars().count(), 64);

    // an empty title is fine
    let mut args = env.args(1, 0, 1, 1);
    args.title = String::new();
    assert_ok(env.try_buy_args(&buyer, &args));
}

#[test]
fn ad_account_is_sized_to_its_content() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    let args = env.args(0, 0, 1, 1);
    assert_ok(env.try_buy_args(&buyer, &args));
    let account = env.svm.get_account(&env.ads[&1]).unwrap();
    assert_eq!(account.data.len(), lotz::state::Ad::space(&args.image_uri, &args.link, &args.title));
}

#[test]
fn epoch_must_be_current_or_next() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    env.advance(3 * WEEK + 5);
    assert_eq!(env.current_epoch(), 3);

    for wrong in [0u32, 2, 5, u32::MAX] {
        let mut args = env.args(0, 0, 1, 1);
        args.epoch = wrong;
        assert_lotz_err(env.try_buy_args(&buyer, &args), LotzError::WrongEpoch);
    }
    let mut args = env.args(0, 0, 1, 1);
    args.epoch = 3;
    assert_ok(env.try_buy_args(&buyer, &args));
    assert_eq!(env.lock_epoch(3).unlock_at, START + 4 * WEEK + YEAR);

    // the next epoch is accepted too (a transaction signed just before the boundary); it locks a little longer
    let mut args = env.args(1, 0, 1, 1);
    args.epoch = 4;
    assert_ok(env.try_buy_args(&buyer, &args));
    assert_eq!(env.lock_epoch(4).unlock_at, START + 5 * WEEK + YEAR);
    assert_eq!(env.lock_epoch(4).amount, BASE_PRICE);
}

#[test]
fn payments_in_one_week_share_an_epoch() {
    let mut env = Env::new();
    let a = env.funded(1_000_000 * TOKEN);
    let b = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&a, 0, 0, 1, 1));
    env.advance(6 * DAY);
    assert_ok(env.try_buy(&b, 1, 0, 2, 1));
    assert_eq!(env.lock_epoch(0).amount, 3 * BASE_PRICE);
    env.advance(DAY);
    assert_eq!(env.current_epoch(), 1);
    assert_ok(env.try_buy(&b, 3, 0, 1, 1));
    assert_eq!(env.lock_epoch(0).amount, 3 * BASE_PRICE);
    assert_eq!(env.lock_epoch(1).amount, BASE_PRICE);
}

#[test]
fn pause_stops_buying_only() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let buyer = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&buyer, 0, 0, 1, 1));
    let taker = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&taker, 0, 0, 1, 1));

    assert_ok(env.try_set_paused(&admin, true));
    assert_lotz_err(env.try_buy(&buyer, 5, 5, 1, 1), LotzError::Paused);
    // refunds and releases keep working
    assert_ok(env.try_claim(&buyer, 1));
    assert_ok(env.try_close(&buyer, 1));
    env.advance(WEEK + YEAR);
    let cranker = env.wallet();
    assert_ok(env.try_release(&cranker, 0));

    assert_ok(env.try_set_paused(&admin, false));
    assert_ok(env.try_buy(&buyer, 5, 5, 1, 1));
}

#[test]
fn start_paused() {
    let mut env = Env::with(MintKind::Spl, InitParams { paused: true, ..default_params() });
    let buyer = env.funded(1_000_000 * TOKEN);
    assert_lotz_err(env.try_buy(&buyer, 0, 0, 1, 1), LotzError::Paused);
}

#[test]
fn shard_accounts_must_be_exact() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    let pk = buyer.pubkey();

    // missing shard (rect 8..12 needs shards 0 and 1)
    let args = env.args(8, 0, 4, 1);
    let ix = env.buy_ix_with(&pk, &args, &[shard_pda(0)], &[]);
    assert_lotz_err(env.send(&[ix], &[&buyer]), LotzError::WrongShards);
    // wrong order
    let ix = env.buy_ix_with(&pk, &args, &[shard_pda(1), shard_pda(0)], &[]);
    assert_lotz_err(env.send(&[ix], &[&buyer]), LotzError::WrongShards);
    // wrong shard
    let ix = env.buy_ix_with(&pk, &args, &[shard_pda(0), shard_pda(2)], &[]);
    assert_lotz_err(env.send(&[ix], &[&buyer]), LotzError::WrongShards);
    // not a shard
    let ix = env.buy_ix_with(&pk, &args, &[shard_pda(0), config_pda()], &[]);
    assert_lotz_err(env.send(&[ix], &[&buyer]), LotzError::WrongShards);
    // right
    let ix = env.buy_ix_with(&pk, &args, &[shard_pda(0), shard_pda(1)], &[]);
    assert_ok(env.send(&[ix], &[&buyer]));
}

#[test]
fn nonce_reuse_by_the_same_buyer_fails() {
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    let args = env.args(0, 0, 1, 1);
    assert_ok(env.try_buy_args(&buyer, &args));
    let mut again = args.clone();
    again.x = 5;
    assert_fails(env.try_buy_args(&buyer, &again));
    // another buyer can use the same nonce: the address includes the buyer
    let other = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy_args(&other, &again));
}

#[test]
fn a_mint_that_changed_after_launch_stops_purchases() {
    // Defence in depth: if the mint ever gained a freeze authority, new money stops going into the vaults.
    let mut env = Env::new();
    let buyer = env.funded(1_000_000 * TOKEN);
    assert_ok(env.try_buy(&buyer, 0, 0, 1, 1));
    let mut account = env.svm.get_account(&env.mint).unwrap();
    let mut mint = <spl_token_interface::state::Mint as solana_program_pack::Pack>::unpack(&account.data).unwrap();
    mint.freeze_authority = solana_program_option::COption::Some(buyer.pubkey());
    solana_program_pack::Pack::pack(mint, &mut account.data).unwrap();
    env.svm.set_account(env.mint, account).unwrap();
    assert_lotz_err(env.try_buy(&buyer, 5, 5, 1, 1), LotzError::UnsupportedMint);
}
