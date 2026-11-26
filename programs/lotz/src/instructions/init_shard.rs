use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::LotzError,
    state::{Config, Shard},
};

/// Creates shard `index` (all lots free). Admin only; several fit in one transaction.
#[derive(Accounts)]
#[instruction(index: u8)]
pub struct InitShard<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LotzError::NotAdmin,
        constraint = !config.retired @ LotzError::Retired,
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = admin, space = 8 + std::mem::size_of::<Shard>(), seeds = [SHARD_SEED, &[index]], bump)]
    pub shard: AccountLoader<'info, Shard>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_shard(ctx: Context<InitShard>, index: u8) -> Result<()> {
    require!(u16::from(index) < SHARD_COUNT, LotzError::InvalidShardIndex);
    let mut shard = ctx.accounts.shard.load_init()?;
    shard.index = index;
    shard.bump = ctx.bumps.shard;
    let config = &mut ctx.accounts.config;
    config.shards_open = config.shards_open.checked_add(1).ok_or(LotzError::MathOverflow)?;
    Ok(())
}
