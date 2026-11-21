//! Lotz: a 1000x1000 pixel board on Solana, sold as 10,000 lots of 10x10 px (brief §2, §3).
//!
//! - Free lots cost the current tier price; taken lots cost 1.5x their last price.
//! - A displaced owner gets back exactly what they paid for the lot (claimable from the refund vault).
//! - Everything else goes to the lock vault, grouped in weekly epochs, each released to the treasury 365 days
//!   after it ends. `release_epoch` is the only instruction that moves tokens out of the lock vault.
#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod mint_check;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;

// Local program id (gitignored keypair in target/deploy/). The mainnet id is the owner's.
declare_id!("4WieikR7HUJt3FkpLQYTocWa9GS4LUio6tuGeDt1DWap");

#[program]
pub mod lotz {
    use super::*;

    /// Upgrade authority only, once. Creates the config and both vaults; the signer becomes the admin.
    pub fn initialize(ctx: Context<Initialize>, params: InitParams) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, params)
    }

    /// Admin only. Creates shard `index` (0..100). Several fit in one transaction.
    pub fn init_shard(ctx: Context<InitShard>, index: u8) -> Result<()> {
        instructions::init_shard::handle_init_shard(ctx, index)
    }

    /// Buys a rectangle of lots: free ones at the tier price, taken ones at 1.5x. Creates the ad.
    pub fn buy<'info>(ctx: Context<'info, Buy<'info>>, args: BuyArgs) -> Result<()> {
        instructions::buy::handle_buy(ctx, args)
    }

    /// The ad's owner takes the refunds for its lots that were taken over.
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        instructions::claim_refund::handle_claim_refund(ctx)
    }

    /// Closes an ad with no live lots and no refund due; the rent goes back to its owner.
    pub fn close_ad(ctx: Context<CloseAd>) -> Result<()> {
        instructions::close_ad::handle_close_ad(ctx)
    }

    /// Anyone, after `unlock_at`: sends the epoch's locked tokens to the treasury.
    pub fn release_epoch(ctx: Context<ReleaseEpoch>, epoch: u32) -> Result<()> {
        instructions::release_epoch::handle_release_epoch(ctx, epoch)
    }

    /// Admin only. Stops or resumes new purchases.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused::handle_set_paused(ctx, paused)
    }
}
