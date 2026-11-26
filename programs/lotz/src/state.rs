//! Accounts (brief §3.1).
use anchor_lang::prelude::*;

use crate::constants::LOTS_PER_SHARD;

/// PDA `["config"]`. Launch parameters are written once by `initialize` and never change; only the counters and
/// `paused` move afterwards.
#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    /// Can pause and resume new purchases and, once paused, retire the board (see `retire`). No access to the
    /// tokens in the vaults.
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    /// The token program that owns `token_mint` (SPL Token or Token-2022).
    pub token_program: Pubkey,
    /// Wallet whose ATA receives every released epoch. Fixed at `initialize`.
    pub treasury: Pubkey,
    /// Price of a free lot in tier 0, in base units of the token.
    pub base_price: u64,
    /// Lots per price tier.
    pub tier_size: u16,
    /// Price multiplier from one tier to the next, in bps (12_500 = 1.25x).
    pub tier_mult_bps: u16,
    /// Always `TAKEOVER_MULT_BPS` (15_000 = 1.5x); stored so clients read it from the chain.
    pub takeover_mult_bps: u16,
    /// Largest rectangle side, in lots (<= 10).
    pub max_rect: u8,
    /// Always `LOCK_PERIOD` (365 days).
    pub lock_period: i64,
    /// Always `EPOCH_LEN` (7 days).
    pub epoch_len: i64,
    /// Unix time of `initialize`; epoch `k` is `[launch_ts + k*epoch_len, launch_ts + (k+1)*epoch_len)`.
    pub launch_ts: i64,
    /// Lots sold at least once. A sold lot never becomes free again.
    pub lots_sold: u16,
    /// Lots taken over, all time.
    pub takeovers: u64,
    /// Tokens paid into the lock, all time.
    pub total_locked: u64,
    /// Tokens released from the lock to the treasury, all time.
    pub total_released: u64,
    /// Sequential id of the next ad. Starts at 1; 0 marks a free lot in a shard.
    pub next_ad_id: u64,
    /// Stops `buy` only.
    pub paused: bool,
    pub bump: u8,
    pub lock_vault_bump: u8,
    pub refund_vault_bump: u8,
    /// Ads that exist: +1 in `buy`, -1 in `close_ad` / `retire_ad`. The config can only be closed at zero, so no
    /// owner's rent or refund is ever left behind.
    pub ads_open: u32,
    /// Shards created and not yet closed.
    pub shards_open: u8,
    /// Set by `retire`, for good: no more purchases; accounts can be closed and their rent returned.
    pub retired: bool,
}

/// One lot inside a shard.
#[zero_copy]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Lot {
    /// Id of the ad currently on this lot; 0 = never sold.
    pub ad_id: u64,
    /// What the current owner paid for this lot.
    pub last_price: u64,
}

/// PDA `["shard", [index]]`. Shard `index` covers lots `lx in [10*(index%10), +10)`, `ly in [10*(index/10), +10)`;
/// `lots` is row-major inside the shard: `lots[(ly%10)*10 + lx%10]`.
#[account(zero_copy)]
#[derive(Debug)]
pub struct Shard {
    pub lots: [Lot; LOTS_PER_SHARD],
    pub index: u8,
    pub bump: u8,
    pub _reserved: [u8; 6],
}

/// PDA `["ad", owner, nonce.to_le_bytes()]`. Created by `buy`; immutable except for the takeover counters.
/// The account is sized to its strings, so the rent is as low as it can be; `close_ad` returns it.
#[account]
#[derive(Debug)]
pub struct Ad {
    pub ad_id: u64,
    pub owner: Pubkey,
    /// Chosen by the buyer's client; only makes the address unique.
    pub nonce: u64,
    /// Rectangle in lots.
    pub x: u8,
    pub y: u8,
    pub w: u8,
    pub h: u8,
    /// Lots of this ad still on the board.
    pub lots_alive: u16,
    /// Refunds for lots taken over and not yet claimed.
    pub refund_due: u64,
    /// What the buyer paid in total for this ad.
    pub paid_total: u64,
    pub created_at: i64,
    pub bump: u8,
    /// sha256 of the image file at `image_uri`.
    pub image_hash: [u8; 32],
    pub image_uri: String,
    pub link: String,
    pub title: String,
}

impl Ad {
    /// Bytes before the strings, discriminator included.
    pub const FIXED_LEN: usize = 8 + 8 + 32 + 8 + 4 + 2 + 8 + 8 + 8 + 1 + 32;

    pub fn space(image_uri: &str, link: &str, title: &str) -> usize {
        Self::FIXED_LEN + 4 + image_uri.len() + 4 + link.len() + 4 + title.len()
    }
}

/// PDA `["epoch", k.to_le_bytes()]` (k: u32). Everything locked during week `k` after launch.
#[account]
#[derive(InitSpace, Debug)]
pub struct LockEpoch {
    pub epoch: u32,
    pub amount: u64,
    /// `launch_ts + (k+1)*epoch_len + lock_period`.
    pub unlock_at: i64,
    pub released: bool,
    pub bump: u8,
}
