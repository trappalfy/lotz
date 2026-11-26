use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::*,
    error::LotzError,
    events::{LotsBought, PriorAdHit},
    math::{epoch_at, takeover_price, tier_of, tier_price, unlock_at},
    mint_check::check_mint,
    state::{Ad, Config, LockEpoch, Shard},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BuyArgs {
    /// Any u64 the buyer's client picks; only makes the ad's address unique.
    pub nonce: u64,
    /// Rectangle in lots: `x, y` in `0..100`, `w, h` in `1..=max_rect`.
    pub x: u8,
    pub y: u8,
    pub w: u8,
    pub h: u8,
    /// Lock epoch the payment goes to: the current one, or the next (for a transaction sent near the boundary).
    pub epoch: u32,
    /// The transaction fails if the total is above this (price moved between quote and signature).
    pub max_total: u64,
    pub image_hash: [u8; 32],
    pub image_uri: String,
    pub link: String,
    pub title: String,
}

/// Remaining accounts, in this order:
/// 1. the shards the rectangle touches (1 to 4, writable), in ascending index order;
/// 2. every previous ad that owns a lot in the rectangle (writable, any order, at most `MAX_PRIOR_ADS`).
#[derive(Accounts)]
#[instruction(args: BuyArgs)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused && !config.retired @ LotzError::Paused,
    )]
    pub config: Box<Account<'info, Config>>,
    #[account(address = config.token_mint, mint::token_program = token_program)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = token_mint, token::authority = buyer, token::token_program = token_program)]
    pub buyer_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [LOCK_VAULT_SEED], bump = config.lock_vault_bump)]
    pub lock_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [REFUND_VAULT_SEED], bump = config.refund_vault_bump)]
    pub refund_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + LockEpoch::INIT_SPACE,
        seeds = [EPOCH_SEED, &args.epoch.to_le_bytes()],
        bump,
    )]
    pub lock_epoch: Box<Account<'info, LockEpoch>>,
    #[account(
        init,
        payer = buyer,
        space = Ad::space(&args.image_uri, &args.link, &args.title),
        seeds = [AD_SEED, buyer.key().as_ref(), &args.nonce.to_le_bytes()],
        bump,
    )]
    pub ad: Box<Account<'info, Ad>>,
    #[account(address = config.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_buy<'info>(ctx: Context<'info, Buy<'info>>, args: BuyArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let buyer = ctx.accounts.buyer.key();
    let config = &ctx.accounts.config;

    validate_rect(&args, config.max_rect)?;
    validate_content(&args)?;
    check_mint(&ctx.accounts.token_mint.to_account_info(), &ctx.accounts.token_mint)?;

    let current_epoch = epoch_at(now, config.launch_ts, config.epoch_len)?;
    require!(
        args.epoch == current_epoch || Some(args.epoch) == current_epoch.checked_add(1),
        LotzError::WrongEpoch
    );

    // --- shards: exactly the ones the rectangle touches, ascending
    let (needed, shard_count) = shards_for_rect(args.x, args.y, args.w, args.h);
    let remaining = ctx.remaining_accounts;
    require!(remaining.len() >= shard_count, LotzError::WrongShards);
    let mut loaders: Vec<AccountLoader<'info, Shard>> = Vec::with_capacity(shard_count);
    for (info, &index) in remaining[..shard_count].iter().zip(needed[..shard_count].iter()) {
        require!(info.is_writable, LotzError::WrongShards);
        // Owner (this program) and discriminator (Shard) are checked here; only `init_shard` creates those, at
        // the PDA of their index, so a matching index is the genuine shard.
        let loader = AccountLoader::<Shard>::try_from(info).map_err(|_| error!(LotzError::WrongShards))?;
        require!(loader.load()?.index == index, LotzError::WrongShards);
        loaders.push(loader);
    }

    // --- price every lot and write the new owner into the shards
    let tier = tier_of(config.lots_sold, config.tier_size);
    let free_price = tier_price(config.base_price, config.tier_mult_bps, tier)?;
    let takeover_mult = config.takeover_mult_bps;
    let ad_id = config.next_ad_id;

    let mut free_lots: u16 = 0;
    let mut taken_lots: u16 = 0;
    let mut total: u128 = 0;
    let mut refunded: u128 = 0;
    let mut prior: Vec<PriorAdHit> = Vec::with_capacity(MAX_PRIOR_ADS);
    {
        let mut shards = Vec::with_capacity(shard_count);
        for loader in &loaders {
            shards.push(loader.load_mut()?);
        }
        for ly in u16::from(args.y)..u16::from(args.y) + u16::from(args.h) {
            for lx in u16::from(args.x)..u16::from(args.x) + u16::from(args.w) {
                let shard_index = shard_index_of(lx, ly);
                let position = needed[..shard_count]
                    .iter()
                    .position(|&i| i == shard_index)
                    .ok_or(LotzError::WrongShards)?;
                let lot = &mut shards[position].lots[lot_offset(lx, ly)];
                if lot.ad_id == 0 {
                    free_lots += 1;
                    total = total.checked_add(u128::from(free_price)).ok_or(LotzError::MathOverflow)?;
                    lot.last_price = free_price;
                } else {
                    let last = lot.last_price;
                    let price = takeover_price(last, takeover_mult)?;
                    taken_lots += 1;
                    total = total.checked_add(u128::from(price)).ok_or(LotzError::MathOverflow)?;
                    refunded = refunded.checked_add(u128::from(last)).ok_or(LotzError::MathOverflow)?;
                    match prior.iter_mut().find(|hit| hit.ad_id == lot.ad_id) {
                        Some(hit) => {
                            hit.lots += 1;
                            hit.refund = hit.refund.checked_add(last).ok_or(LotzError::MathOverflow)?;
                        }
                        None => {
                            require!(prior.len() < MAX_PRIOR_ADS, LotzError::TooManyPriorAds);
                            prior.push(PriorAdHit { ad_id: lot.ad_id, lots: 1, refund: last });
                        }
                    }
                    lot.last_price = price;
                }
                lot.ad_id = ad_id;
            }
        }
    }

    let total = u64::try_from(total).map_err(|_| error!(LotzError::MathOverflow))?;
    let refunded = u64::try_from(refunded).map_err(|_| error!(LotzError::MathOverflow))?;
    // Lock share as `total - refunds`, so no base unit is lost to rounding (brief §3.4).
    let locked = total.checked_sub(refunded).ok_or(LotzError::MathOverflow)?;
    require!(total <= args.max_total, LotzError::SlippageExceeded);

    // --- previous ads: one less live lot and a refund for each lot taken
    credit_prior_ads(&remaining[shard_count..], &prior, &buyer)?;

    // --- payments: the lock share to the lock, the refunds to the refund vault
    let accounts = &ctx.accounts;
    let decimals = accounts.token_mint.decimals;
    let transfer = |to: AccountInfo<'info>, amount: u64| -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        token_interface::transfer_checked(
            CpiContext::new(
                accounts.token_program.key(),
                TransferChecked {
                    from: accounts.buyer_token.to_account_info(),
                    mint: accounts.token_mint.to_account_info(),
                    to,
                    authority: accounts.buyer.to_account_info(),
                },
            ),
            amount,
            decimals,
        )
    };
    transfer(accounts.lock_vault.to_account_info(), locked)?;
    transfer(accounts.refund_vault.to_account_info(), refunded)?;

    // --- state
    let config = &mut ctx.accounts.config;
    let lock_epoch = &mut ctx.accounts.lock_epoch;
    require!(!lock_epoch.released, LotzError::AlreadyReleased);
    if lock_epoch.unlock_at == 0 {
        lock_epoch.epoch = args.epoch;
        lock_epoch.unlock_at = unlock_at(args.epoch, config.launch_ts, config.epoch_len, config.lock_period)?;
        lock_epoch.released = false;
        lock_epoch.bump = ctx.bumps.lock_epoch;
    }
    lock_epoch.amount = lock_epoch.amount.checked_add(locked).ok_or(LotzError::MathOverflow)?;

    config.lots_sold = config.lots_sold.checked_add(free_lots).ok_or(LotzError::MathOverflow)?;
    // lifetime statistics: saturate rather than ever block purchases
    config.takeovers = config.takeovers.saturating_add(u64::from(taken_lots));
    config.total_locked = config.total_locked.saturating_add(locked);
    config.next_ad_id = config.next_ad_id.checked_add(1).ok_or(LotzError::MathOverflow)?;
    config.ads_open = config.ads_open.checked_add(1).ok_or(LotzError::MathOverflow)?;
    let lots_sold = config.lots_sold;

    let ad_key = ctx.accounts.ad.key();
    ctx.accounts.ad.set_inner(Ad {
        ad_id,
        owner: buyer,
        nonce: args.nonce,
        x: args.x,
        y: args.y,
        w: args.w,
        h: args.h,
        lots_alive: u16::from(args.w) * u16::from(args.h),
        refund_due: 0,
        paid_total: total,
        created_at: now,
        bump: ctx.bumps.ad,
        image_hash: args.image_hash,
        image_uri: args.image_uri.clone(),
        link: args.link.clone(),
        title: args.title.clone(),
    });

    emit!(LotsBought {
        ad_id,
        ad: ad_key,
        buyer,
        x: args.x,
        y: args.y,
        w: args.w,
        h: args.h,
        free_lots,
        taken_lots,
        tier,
        free_lot_price: free_price,
        paid_total: total,
        locked,
        refunded,
        epoch: args.epoch,
        lots_sold,
        prior,
        image_hash: args.image_hash,
        image_uri: args.image_uri,
        link: args.link,
        title: args.title,
        timestamp: now,
    });
    Ok(())
}

/// Every account in `ad_infos` must be a writable Lotz `Ad`; every hit must find its ad among them.
fn credit_prior_ads(ad_infos: &[AccountInfo], prior: &[PriorAdHit], buyer: &Pubkey) -> Result<()> {
    let mut ads: Vec<(usize, Ad)> = Vec::with_capacity(ad_infos.len());
    for (i, info) in ad_infos.iter().enumerate() {
        require!(info.owner == &crate::ID && info.is_writable, LotzError::InvalidPriorAd);
        let ad = {
            let data = info.try_borrow_data()?;
            Ad::try_deserialize(&mut &data[..]).map_err(|_| error!(LotzError::InvalidPriorAd))?
        };
        ads.push((i, ad));
    }
    for hit in prior {
        let (i, ad) =
            ads.iter_mut().find(|(_, ad)| ad.ad_id == hit.ad_id).ok_or(LotzError::PriorAdMissing)?;
        require_keys_neq!(ad.owner, *buyer, LotzError::OwnLot);
        ad.lots_alive = ad.lots_alive.checked_sub(hit.lots).ok_or(LotzError::MathOverflow)?;
        ad.refund_due = ad.refund_due.checked_add(hit.refund).ok_or(LotzError::MathOverflow)?;
        let mut data = ad_infos[*i].try_borrow_mut_data()?;
        ad.try_serialize(&mut &mut data[..])?;
    }
    Ok(())
}

fn validate_rect(args: &BuyArgs, max_rect: u8) -> Result<()> {
    require!(args.w >= 1 && args.h >= 1 && args.w <= max_rect && args.h <= max_rect, LotzError::RectTooLarge);
    require!(
        u16::from(args.x) + u16::from(args.w) <= BOARD_SIDE
            && u16::from(args.y) + u16::from(args.h) <= BOARD_SIDE,
        LotzError::RectOutOfBounds
    );
    Ok(())
}

fn is_printable_ascii(s: &str) -> bool {
    s.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

fn validate_content(args: &BuyArgs) -> Result<()> {
    require!(args.image_hash != [0u8; 32], LotzError::MissingImageHash);
    require!(
        !args.image_uri.is_empty()
            && args.image_uri.len() <= MAX_IMAGE_URI_LEN
            && is_printable_ascii(&args.image_uri),
        LotzError::InvalidImageUri
    );
    require!(
        args.link.len() > LINK_SCHEME.len()
            && args.link.len() <= MAX_LINK_LEN
            && args.link.starts_with(LINK_SCHEME)
            && is_printable_ascii(&args.link),
        LotzError::InvalidLink
    );
    require!(
        args.title.chars().count() <= MAX_TITLE_CHARS && !args.title.chars().any(char::is_control),
        LotzError::InvalidTitle
    );
    Ok(())
}

pub fn shard_index_of(lx: u16, ly: u16) -> u8 {
    ((ly / SHARD_SIDE) * SHARDS_PER_SIDE + lx / SHARD_SIDE) as u8
}

pub fn lot_offset(lx: u16, ly: u16) -> usize {
    usize::from((ly % SHARD_SIDE) * SHARD_SIDE + lx % SHARD_SIDE)
}

/// Shards touched by a (validated) rectangle, ascending, and how many.
pub fn shards_for_rect(x: u8, y: u8, w: u8, h: u8) -> ([u8; MAX_SHARDS_PER_BUY], usize) {
    let (x, y, w, h) = (u16::from(x), u16::from(y), u16::from(w), u16::from(h));
    let mut out = [0u8; MAX_SHARDS_PER_BUY];
    let mut n = 0;
    for sy in y / SHARD_SIDE..=(y + h - 1) / SHARD_SIDE {
        for sx in x / SHARD_SIDE..=(x + w - 1) / SHARD_SIDE {
            out[n] = (sy * SHARDS_PER_SIDE + sx) as u8;
            n += 1;
        }
    }
    (out, n)
}
