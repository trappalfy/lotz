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
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ LotzError::NotAdmin)]
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
    Ok(())
}
