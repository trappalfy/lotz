mod common;

use common::*;
use lotz::{error::LotzError, events::ConfigInitialized, InitParams};
use solana_signer::Signer;

#[test]
fn initialize_sets_config_and_vaults() {
    let mut env = Env::bare(MintKind::Spl);
    let admin = env.admin.insecure_clone();
    let meta = assert_ok(env.try_initialize(&admin, default_params()));

    let c = env.config();
    assert_eq!(c.admin, admin.pubkey());
    assert_eq!(c.token_mint, env.mint);
    assert_eq!(c.token_program, TOKEN_PROGRAM);
    assert_eq!(c.treasury, env.treasury.pubkey());
    assert_eq!(c.base_price, BASE_PRICE);
    assert_eq!(c.tier_size, 1_000);
    assert_eq!(c.tier_mult_bps, 12_500);
    assert_eq!(c.takeover_mult_bps, 15_000);
    assert_eq!(c.max_rect, 10);
    assert_eq!(c.lock_period, 365 * DAY);
    assert_eq!(c.epoch_len, 7 * DAY);
    assert_eq!(c.launch_ts, START);
    assert_eq!(c.lots_sold, 0);
    assert_eq!(c.next_ad_id, 1);
    assert!(!c.paused);
    assert_eq!(env.lock_balance(), 0);
    assert_eq!(env.refund_balance(), 0);

    let ev: ConfigInitialized = one_event(&meta);
    assert_eq!(ev.treasury, env.treasury.pubkey());
    assert_eq!(ev.launch_ts, START);
}

#[test]
fn only_upgrade_authority_can_initialize() {
    let mut env = Env::bare(MintKind::Spl);
    let stranger = env.wallet();
    assert_lotz_err(env.try_initialize(&stranger, default_params()), LotzError::NotUpgradeAuthority);

    // An immutable program (no upgrade authority) cannot be initialised by anyone.
    env.set_upgrade_authority(None);
    let admin = env.admin.insecure_clone();
    assert_lotz_err(env.try_initialize(&admin, default_params()), LotzError::NotUpgradeAuthority);
}

#[test]
fn initialize_runs_once() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    assert_fails(env.try_initialize(&admin, default_params()));
}

#[test]
fn launch_parameters_are_checked() {
    let bad = [
        InitParams { base_price: 0, ..default_params() },
        InitParams { tier_size: 99, ..default_params() },
        InitParams { tier_size: 10_001, ..default_params() },
        InitParams { tier_mult_bps: 9_999, ..default_params() },
        InitParams { tier_mult_bps: 30_001, ..default_params() },
        InitParams { max_rect: 0, ..default_params() },
        InitParams { max_rect: 11, ..default_params() },
        // top tier price x 100 lots overflows u64
        InitParams { base_price: u64::MAX / 50, ..default_params() },
    ];
    for params in bad {
        let mut env = Env::bare(MintKind::Spl);
        let admin = env.admin.insecure_clone();
        assert_lotz_err(env.try_initialize(&admin, params.clone()), LotzError::InvalidParams);
    }
}

#[test]
fn mints_that_could_touch_the_lock_are_refused() {
    for kind in
        [MintKind::SplWithFreeze, MintKind::Token2022PermanentDelegate, MintKind::Token2022TransferFee]
    {
        let mut env = Env::bare(kind);
        let admin = env.admin.insecure_clone();
        assert_lotz_err(env.try_initialize(&admin, default_params()), LotzError::UnsupportedMint);
    }
}

#[test]
fn close_authority_extension_without_an_authority_is_accepted() {
    let env = Env::with(MintKind::Token2022CloseAuthorityNone, default_params());
    assert_eq!(env.config().token_program, TOKEN_2022_PROGRAM);
}

#[test]
fn treasury_must_be_a_wallet() {
    // a token account, a program-owned account and the program itself are all refused: the treasury can never change
    let mut env = Env::bare(MintKind::Spl);
    let admin = env.admin.insecure_clone();
    let token_account = env.create_ata(&admin.pubkey());
    for bad in [token_account, env.mint, lotz::ID] {
        let mut ix = env.initialize_ix(&admin.pubkey(), default_params());
        ix.accounts[3].pubkey = bad;
        assert_lotz_err(env.send(&[ix], &[&admin]), LotzError::WrongTreasury);
    }
    // a fresh address (no account yet) is a wallet
    assert_ok(env.try_initialize(&admin, default_params()));
}

#[test]
fn token_2022_mint_with_metadata_is_accepted() {
    let env = Env::with(MintKind::Token2022Metadata, default_params());
    let c = env.config();
    assert_eq!(c.token_program, TOKEN_2022_PROGRAM);
    assert_eq!(env.svm.get_account(&lock_vault()).unwrap().owner, TOKEN_2022_PROGRAM);
}

#[test]
fn shards_are_admin_only_and_bounded() {
    let mut env = Env::bare(MintKind::Spl);
    let admin = env.admin.insecure_clone();
    assert_ok(env.try_initialize(&admin, default_params()));

    let stranger = env.wallet();
    let ix = env.init_shard_ix(&stranger.pubkey(), 0);
    assert_lotz_err(env.send(&[ix], &[&stranger]), LotzError::NotAdmin);

    let ix = env.init_shard_ix(&admin.pubkey(), 100);
    assert_lotz_err(env.send(&[ix], &[&admin]), LotzError::InvalidShardIndex);

    let ix = env.init_shard_ix(&admin.pubkey(), 42);
    assert_ok(env.send(&[ix], &[&admin]));
    let shard = env.shard(42);
    assert_eq!(shard.index, 42);
    assert!(shard.lots.iter().all(|l| l.ad_id == 0 && l.last_price == 0));

    // twice: the account exists
    let ix = env.init_shard_ix(&admin.pubkey(), 42);
    assert_fails(env.send(&[ix], &[&admin]));
}

#[test]
fn pause_is_admin_only() {
    let mut env = Env::new();
    let stranger = env.wallet();
    assert_lotz_err(env.try_set_paused(&stranger, true), LotzError::NotAdmin);
    let admin = env.admin.insecure_clone();
    assert_ok(env.try_set_paused(&admin, true));
    assert!(env.config().paused);
    assert_ok(env.try_set_paused(&admin, false));
    assert!(!env.config().paused);
}
