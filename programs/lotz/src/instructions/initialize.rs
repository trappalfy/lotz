use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*, error::LotzError, events::ConfigInitialized, mint_check::check_mint, program::Lotz, state::Config,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitParams {
    /// Tier-0 price of a free lot, in base units of the token.
    pub base_price: u64,
    pub tier_size: u16,
    pub tier_mult_bps: u16,
    /// Largest rectangle side in lots, 1..=10.
    pub max_rect: u8,
    /// Start paused (the admin resumes with `set_paused(false)`).
    pub paused: bool,
}

/// Creates `Config` and both vaults. Only the program's upgrade authority can call it, once, so nobody can
/// front-run the owner between deploy and initialisation. The signer becomes the admin.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mint::token_program = token_program)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: the wallet that receives released epochs; only its key is stored. It must be a wallet (an account
    /// owned by the System program, which includes a multisig vault such as Squads'), never a token account or a
    /// program's PDA, because it can never be changed.
    #[account(constraint = *treasury.owner == anchor_lang::system_program::ID @ LotzError::WrongTreasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [LOCK_VAULT_SEED],
        bump,
        token::mint = token_mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub lock_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = admin,
        seeds = [REFUND_VAULT_SEED],
        bump,
        token::mint = token_mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub refund_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(constraint = lotz_program.programdata_address()? == Some(program_data.key()) @ LotzError::NotUpgradeAuthority)]
    pub lotz_program: Program<'info, Lotz>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ LotzError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, params: InitParams) -> Result<()> {
    require!(params.base_price > 0, LotzError::InvalidParams);
    require!(params.tier_size >= MIN_TIER_SIZE && params.tier_size <= TOTAL_LOTS, LotzError::InvalidParams);
    require!(
        (MIN_TIER_MULT_BPS..=MAX_TIER_MULT_BPS).contains(&params.tier_mult_bps),
        LotzError::InvalidParams
    );
    require!(params.max_rect >= 1 && params.max_rect <= MAX_RECT_LIMIT, LotzError::InvalidParams);
    // The highest tier's price must fit in u64, and a full 10x10 rectangle at that price too.
    let top_tier = (TOTAL_LOTS - 1) / params.tier_size;
    let top_price = crate::math::tier_price(params.base_price, params.tier_mult_bps, top_tier)?;
    top_price
        .checked_mul(u64::from(MAX_RECT_LIMIT) * u64::from(MAX_RECT_LIMIT))
        .ok_or(LotzError::InvalidParams)?;

    check_mint(&ctx.accounts.token_mint.to_account_info(), &ctx.accounts.token_mint)?;

    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    config.set_inner(Config {
        admin: ctx.accounts.admin.key(),
        token_mint: ctx.accounts.token_mint.key(),
        token_program: ctx.accounts.token_program.key(),
        treasury: ctx.accounts.treasury.key(),
        base_price: params.base_price,
        tier_size: params.tier_size,
        tier_mult_bps: params.tier_mult_bps,
        takeover_mult_bps: TAKEOVER_MULT_BPS,
        max_rect: params.max_rect,
        lock_period: LOCK_PERIOD,
        epoch_len: EPOCH_LEN,
        launch_ts: now,
        lots_sold: 0,
        takeovers: 0,
        total_locked: 0,
        total_released: 0,
        next_ad_id: 1,
        paused: params.paused,
        bump: ctx.bumps.config,
        lock_vault_bump: ctx.bumps.lock_vault,
        refund_vault_bump: ctx.bumps.refund_vault,
        ads_open: 0,
        shards_open: 0,
        retired: false,
    });

    emit!(ConfigInitialized {
        admin: config.admin,
        token_mint: config.token_mint,
        token_program: config.token_program,
        treasury: config.treasury,
        base_price: config.base_price,
        tier_size: config.tier_size,
        tier_mult_bps: config.tier_mult_bps,
        takeover_mult_bps: config.takeover_mult_bps,
        max_rect: config.max_rect,
        lock_period: config.lock_period,
        epoch_len: config.epoch_len,
        launch_ts: config.launch_ts,
        paused: config.paused,
    });
    Ok(())
}
