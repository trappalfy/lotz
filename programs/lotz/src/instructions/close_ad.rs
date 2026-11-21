use anchor_lang::prelude::*;

use crate::{error::LotzError, events::AdClosed, state::Ad};

/// Closes an ad with no live lots and nothing left to claim; the rent goes back to its owner.
#[derive(Accounts)]
pub struct CloseAd<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        has_one = owner @ LotzError::NotAdOwner,
        constraint = ad.lots_alive == 0 && ad.refund_due == 0 @ LotzError::AdNotEmpty,
        close = owner,
    )]
    pub ad: Box<Account<'info, Ad>>,
}

pub fn handle_close_ad(ctx: Context<CloseAd>) -> Result<()> {
    emit!(AdClosed {
        ad_id: ctx.accounts.ad.ad_id,
        ad: ctx.accounts.ad.key(),
        owner: ctx.accounts.owner.key()
    });
    Ok(())
}
