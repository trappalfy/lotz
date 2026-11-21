//! The whole flow with a Token-2022 mint (metadata pointer, like a launchpad coin).
mod common;

use common::*;
use solana_signer::Signer;

#[test]
fn buy_takeover_claim_close_release_with_token_2022() {
    let mut env = Env::with(MintKind::Token2022Metadata, default_params());
    assert_eq!(env.token_program, TOKEN_2022_PROGRAM);
    let alice = env.funded(1_000_000 * TOKEN);
    let bob = env.funded(1_000_000 * TOKEN);

    assert_ok(env.try_buy(&alice, 0, 0, 3, 3));
    assert_eq!(env.lock_balance(), 9 * BASE_PRICE);
    assert_ok(env.try_buy(&bob, 1, 1, 3, 3));
    // 4 of Alice's lots taken
    assert_eq!(env.refund_balance(), 4 * BASE_PRICE);
    assert_eq!(env.lock_balance(), 9 * BASE_PRICE + 2 * BASE_PRICE + 5 * BASE_PRICE);

    let before = env.tokens(&alice.pubkey());
    assert_ok(env.try_claim(&alice, 1));
    assert_eq!(env.tokens(&alice.pubkey()) - before, 4 * BASE_PRICE);

    // Bob takes the rest of Alice's ad, she claims and closes it
    assert_ok(env.try_buy(&bob, 0, 0, 3, 1));
    assert_ok(env.try_buy(&bob, 0, 1, 1, 2));
    assert_eq!(env.ad_by_id(1).lots_alive, 0);
    assert_ok(env.try_claim(&alice, 1));
    assert_ok(env.try_close(&alice, 1));
    assert_eq!(env.tokens(&alice.pubkey()), 1_000_000 * TOKEN, "Alice got every token back");

    env.advance(WEEK + YEAR);
    let cranker = env.wallet();
    let locked = env.lock_balance();
    assert_ok(env.try_release(&cranker, 0));
    assert_eq!(env.tokens(&env.treasury.pubkey()), locked);
    assert_eq!(env.lock_balance(), 0);
}
