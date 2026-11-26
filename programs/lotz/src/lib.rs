//! Lotz: a 1000x1000 pixel board on Solana, sold as 10,000 lots of 10x10 px (brief §2, §3).
//!
//! - Free lots cost the current tier price; taken lots cost 1.5x their last price.
//! - A displaced owner gets back exactly what they paid for the lot (claimable from the refund vault).
//! - Everything else goes to the lock vault, grouped in weekly epochs, each released to the treasury 365 days
//!   after it ends. `release_epoch` is the only instruction that moves tokens out of the lock vault.
//! - Retiring (admin, after pausing): owed refunds and ad rent go back to their owners first; then shards, config and
//!   empty vaults close and their rent returns to the admin, so the program itself can be closed.
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
declare_id!("LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa");

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

    /// The ad's owner takes the refunds for its lots that were taken over (anyone may send them once retired).
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        instructions::claim_refund::handle_claim_refund(ctx)
    }

    /// Closes an ad with no live lots and no refund due (any ad once retired); the rent goes back to its owner.
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

    /// Admin only, buying paused. Retires the board for good: no more purchases or resuming.
    pub fn retire(ctx: Context<Retire>) -> Result<()> {
        instructions::retire::handle_retire(ctx)
    }

    /// Admin only, once retired: closes a released epoch record; its rent goes to the admin.
    pub fn retire_epoch(ctx: Context<RetireEpoch>, epoch: u32) -> Result<()> {
        instructions::retire::handle_retire_epoch(ctx, epoch)
    }

    /// Admin only, once retired: closes the shards passed as remaining accounts; their rent goes to the admin.
    pub fn retire_shards<'info>(ctx: Context<'info, RetireShards<'info>>) -> Result<()> {
        instructions::retire::handle_retire_shards(ctx)
    }

    /// Admin only, once retired, with no ad or shard left: closes the empty vaults and the config; the rent goes to
    /// the admin. After this the program can be closed.
    pub fn retire_config(ctx: Context<RetireConfig>) -> Result<()> {
        instructions::retire::handle_retire_config(ctx)
    }
}
