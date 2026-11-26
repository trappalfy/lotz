//! Retiring the board: the admin's way to wind Lotz down and get the rent back, in an order the program enforces.
//!
//! 1. `retire` (admin, buying paused): marks the board retired for good. No more purchases, no resuming.
//! 2. `claim_refund`, `close_ad` (anyone, once retired): every owed refund goes to its owner's token account and
//!    every ad's rent back to its owner. Nobody else's money can be left behind: the config cannot close while an ad
//!    exists.
//! 3. `retire_epoch` (released epochs), `retire_shards` (admin): their rent goes to the admin.
//! 4. `retire_config` (admin, no ad and no shard left): closes each vault that is empty, and the config; the rent
//!    goes to the admin. Then the program itself can be closed by its upgrade
//!    authority.
//!
//! None of these moves a locked token: `release_epoch` stays the only way out of the lock vault. If the board is
//! retired before every epoch is released, the remaining tokens stay in the lock vault for good.
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{self, CloseAccount, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::LotzError,
    events::{ConfigClosed, Retired},
    state::{Config, LockEpoch, Shard},
};

// ---------------------------------------------------------------- retire

#[derive(Accounts)]
pub struct Retire<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LotzError::NotAdmin,
        constraint = config.paused @ LotzError::NotPaused,
        constraint = !config.retired @ LotzError::Retired,
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn handle_retire(ctx: Context<Retire>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.retired = true;
    emit!(Retired {
        locked_left: config.total_locked.saturating_sub(config.total_released),
        ads_open: config.ads_open,
    });
    Ok(())
}

// ---------------------------------------------------------------- retire_epoch

/// Closes a released epoch record (its tokens are already with the treasury); the rent goes to the admin.
#[derive(Accounts)]
#[instruction(epoch: u32)]
pub struct RetireEpoch<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LotzError::NotAdmin,
        constraint = config.retired @ LotzError::NotRetired,
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [EPOCH_SEED, &epoch.to_le_bytes()],
        bump = lock_epoch.bump,
        constraint = lock_epoch.released @ LotzError::StillLocked,
        close = admin,
    )]
    pub lock_epoch: Box<Account<'info, LockEpoch>>,
}

pub fn handle_retire_epoch(_ctx: Context<RetireEpoch>, _epoch: u32) -> Result<()> {
    Ok(())
}

// ---------------------------------------------------------------- retire_shards

/// Closes the shards passed as remaining accounts (each checked to be a Lotz shard at its own address).
#[derive(Accounts)]
pub struct RetireShards<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LotzError::NotAdmin,
        constraint = config.retired @ LotzError::NotRetired,
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn handle_retire_shards<'info>(ctx: Context<'info, RetireShards<'info>>) -> Result<()> {
    let admin = ctx.accounts.admin.to_account_info();
    let mut closed: u8 = 0;
    for info in ctx.remaining_accounts.iter() {
        require!(info.is_writable, LotzError::NotAShard);
        // owner and discriminator are checked by the loader; the address must be the shard PDA it claims to be
        let (index, bump) = {
            let loader = AccountLoader::<Shard>::try_from(info).map_err(|_| LotzError::NotAShard)?;
            let shard = loader.load()?;
            (shard.index, shard.bump)
        };
        let expected = Pubkey::create_program_address(&[SHARD_SEED, &[index], &[bump]], &crate::ID)
            .map_err(|_| LotzError::NotAShard)?;
        require_keys_eq!(*info.key, expected, LotzError::NotAShard);
        close_to(info, &admin)?;
        closed = closed.checked_add(1).ok_or(LotzError::MathOverflow)?;
    }
    let config = &mut ctx.accounts.config;
    config.shards_open = config.shards_open.saturating_sub(closed);
    Ok(())
}

// ---------------------------------------------------------------- retire_config

#[derive(Accounts)]
pub struct RetireConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LotzError::NotAdmin,
        constraint = config.retired @ LotzError::NotRetired,
        constraint = config.ads_open == 0 && config.shards_open == 0 @ LotzError::StillOpen,
        close = admin,
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [LOCK_VAULT_SEED], bump = config.lock_vault_bump)]
    pub lock_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [REFUND_VAULT_SEED], bump = config.refund_vault_bump)]
    pub refund_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_retire_config(ctx: Context<RetireConfig>) -> Result<()> {
    let bump = [ctx.accounts.config.bump];
    let seeds: [&[u8]; 2] = [CONFIG_SEED, &bump];
    let signer: &[&[&[u8]]] = &[&seeds];
    // A vault can only close when empty. Every ad is closed by now, so nothing is owed from the refund vault and any
    // balance there was sent to it directly; the lock vault still holds tokens if the board retired before every
    // epoch was released. A vault that is not empty stays open for good (with its tokens), and the config closes
    // anyway, so nobody can block the wind-down by sending a token to a vault.
    let refund_left = ctx.accounts.refund_vault.amount;
    let locked_left = ctx.accounts.lock_vault.amount;
    for (vault, left) in [
        (ctx.accounts.refund_vault.to_account_info(), refund_left),
        (ctx.accounts.lock_vault.to_account_info(), locked_left),
    ] {
        if left == 0 {
            token_interface::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                CloseAccount {
                    account: vault,
                    destination: ctx.accounts.admin.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ))?;
        }
    }
    emit!(ConfigClosed { locked_left, refund_left });
    Ok(())
}

/// Moves all lamports to `dest`, gives the account back to the system program and empties it (what Anchor's `close`
/// constraint does, for accounts that arrive as remaining accounts).
fn close_to<'info>(info: &AccountInfo<'info>, dest: &AccountInfo<'info>) -> Result<()> {
    require_keys_neq!(*info.key, *dest.key, LotzError::NotAShard);
    let lamports = info.lamports();
    dest.add_lamports(lamports)?;
    **info.try_borrow_mut_lamports()? = 0;
    info.assign(&system_program::ID);
    info.resize(0)?;
    Ok(())
}
