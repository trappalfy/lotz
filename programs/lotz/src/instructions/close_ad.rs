use anchor_lang::prelude::*;

use crate::{
    constants::CONFIG_SEED,
    error::LotzError,
    events::AdClosed,
    state::{Ad, Config},
};

/// Closes an ad; the rent goes back to its owner. The owner can close an ad with no live lots and nothing to claim.
/// Once the board is retired anyone can close any ad with nothing to claim (refunds are paid out first).
#[derive(Accounts)]
pub struct CloseAd<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        constraint = config.retired || caller.key() == ad.owner @ LotzError::NotAdOwner,
        constraint = ad.refund_due == 0 && (config.retired || ad.lots_alive == 0) @ LotzError::AdNotEmpty,
        close = owner,
    )]
    pub ad: Box<Account<'info, Ad>>,
    /// CHECK: the ad's owner; only receives the rent.
    #[account(mut, address = ad.owner @ LotzError::NotAdOwner)]
    pub owner: UncheckedAccount<'info>,
}

pub fn handle_close_ad(ctx: Context<CloseAd>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.ads_open = config.ads_open.saturating_sub(1);
    emit!(AdClosed {
        ad_id: ctx.accounts.ad.ad_id,
        ad: ctx.accounts.ad.key(),
        owner: ctx.accounts.owner.key()
    });
    Ok(())
}
