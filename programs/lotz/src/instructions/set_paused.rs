use anchor_lang::prelude::*;

use crate::{constants::CONFIG_SEED, error::LotzError, events::PausedSet, state::Config};

/// Admin only. Stops or resumes `buy`. Touches nothing else: no vault, no price, no ad.
#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ LotzError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
}

pub fn handle_set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    // a retired board stays closed
    require!(!ctx.accounts.config.retired, LotzError::Retired);
    ctx.accounts.config.paused = paused;
    emit!(PausedSet { paused });
    Ok(())
}
