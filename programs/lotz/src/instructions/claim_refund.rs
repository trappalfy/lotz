use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    constants::*,
    error::LotzError,
    events::RefundClaimed,
    state::{Ad, Config},
};

/// The ad's owner takes `refund_due` from the refund vault to their ATA (created if missing).
#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(address = config.token_mint, mint::token_program = token_program)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, has_one = owner @ LotzError::NotAdOwner)]
    pub ad: Box<Account<'info, Ad>>,
    #[account(mut, seeds = [REFUND_VAULT_SEED], bump = config.refund_vault_bump)]
    pub refund_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = token_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let amount = ctx.accounts.ad.refund_due;
    require!(amount > 0, LotzError::NothingToClaim);
    ctx.accounts.ad.refund_due = 0;

    let bump = [ctx.accounts.config.bump];
    let seeds: [&[u8]; 2] = [CONFIG_SEED, &bump];
    let signer: &[&[&[u8]]] = &[&seeds];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.refund_vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.owner_token.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    emit!(RefundClaimed {
        ad_id: ctx.accounts.ad.ad_id,
        ad: ctx.accounts.ad.key(),
        owner: ctx.accounts.owner.key(),
        amount,
    });
    Ok(())
}
