//! Events (brief §3.3). Emitted with `emit!` (program logs); the indexer decodes them from the logs.
use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub token_program: Pubkey,
    pub treasury: Pubkey,
    pub base_price: u64,
    pub tier_size: u16,
    pub tier_mult_bps: u16,
    pub takeover_mult_bps: u16,
    pub max_rect: u8,
    pub lock_period: i64,
    pub epoch_len: i64,
    pub launch_ts: i64,
    pub paused: bool,
}

/// One previous ad that lost lots in a purchase.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct PriorAdHit {
    pub ad_id: u64,
    pub lots: u16,
    pub refund: u64,
}

#[event]
pub struct LotsBought {
    pub ad_id: u64,
    pub ad: Pubkey,
    pub buyer: Pubkey,
    pub x: u8,
    pub y: u8,
    pub w: u8,
    pub h: u8,
    pub free_lots: u16,
    pub taken_lots: u16,
    /// Price tier the free lots were priced at.
    pub tier: u16,
    /// Price of one free lot at that tier.
    pub free_lot_price: u64,
    pub paid_total: u64,
    pub locked: u64,
    pub refunded: u64,
    pub epoch: u32,
    /// `Config.lots_sold` after this purchase.
    pub lots_sold: u16,
    pub prior: Vec<PriorAdHit>,
    pub image_hash: [u8; 32],
    pub image_uri: String,
    pub link: String,
    pub title: String,
    pub timestamp: i64,
}

#[event]
pub struct RefundClaimed {
    pub ad_id: u64,
    pub ad: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AdClosed {
    pub ad_id: u64,
    pub ad: Pubkey,
    pub owner: Pubkey,
}

/// The admin retired the board: no more purchases; accounts are being closed.
#[event]
pub struct Retired {
    /// Tokens still in the lock (they stay there for good if the lock vault cannot be emptied first).
    pub locked_left: u64,
    pub ads_open: u32,
}

/// The config and the vaults were closed: the last step before the program itself can be closed.
#[event]
pub struct ConfigClosed {
    /// Tokens left in the lock vault, which then stays open for good.
    pub locked_left: u64,
    /// Tokens someone sent straight to the refund vault (nothing is owed by then); it then stays open for good.
    pub refund_left: u64,
}

#[event]
pub struct EpochReleased {
    pub epoch: u32,
    pub amount: u64,
    pub treasury: Pubkey,
    pub total_released: u64,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
}
