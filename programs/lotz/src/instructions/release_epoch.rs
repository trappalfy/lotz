use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    constants::*,
    error::LotzError,
    events::EpochReleased,
    state::{Config, LockEpoch},
};

/// Permissionless crank: once `unlock_at` has passed, moves the epoch's tokens from the lock vault to the
/// treasury's ATA (created if missing, paid by the caller). The only way tokens leave the lock vault.
#[derive(Accounts)]
#[instruction(epoch: u32)]
pub struct ReleaseEpoch<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(address = config.token_mint, mint::token_program = token_program)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch.to_le_bytes()], bump = lock_epoch.bump)]
    pub lock_epoch: Box<Account<'info, LockEpoch>>,
    #[account(mut, seeds = [LOCK_VAULT_SEED], bump = config.lock_vault_bump)]
    pub lock_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: must be the treasury fixed at `initialize`.
    #[account(address = config.treasury @ LotzError::WrongTreasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = token_mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_release_epoch(ctx: Context<ReleaseEpoch>, epoch: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let lock_epoch = &mut ctx.accounts.lock_epoch;
    require!(!lock_epoch.released, LotzError::AlreadyReleased);
    require!(now >= lock_epoch.unlock_at, LotzError::StillLocked);
    let amount = lock_epoch.amount;
    lock_epoch.released = true;

    let config = &mut ctx.accounts.config;
    config.total_released = config.total_released.saturating_add(amount);
    let total_released = config.total_released;

    let bump = [config.bump];
    let seeds: [&[u8]; 2] = [CONFIG_SEED, &bump];
    let signer: &[&[&[u8]]] = &[&seeds];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.lock_vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.treasury_token.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    emit!(EpochReleased { epoch, amount, treasury: ctx.accounts.treasury.key(), total_released });
    Ok(())
}
