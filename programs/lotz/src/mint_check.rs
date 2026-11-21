//! The lock is only a lock if nobody can take tokens out of the vaults, freeze them or tax them. Checked in
//! `initialize` and again in every `buy` (so a mint that somehow changed stops taking new deposits).
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::{
        self,
        extension::{
            mint_close_authority::MintCloseAuthority, BaseStateWithExtensions, ExtensionType, StateWithExtensions,
        },
    },
    token_interface::Mint,
};

use crate::error::LotzError;

/// Token-2022 extensions that cannot move, freeze, tax or block tokens held in the vaults.
/// `MintCloseAuthority` is allowed only with no authority set: a closable mint can be closed at zero supply and
/// re-created at the same address with, say, a permanent delegate.
const ALLOWED_MINT_EXTENSIONS: [ExtensionType; 9] = [
    ExtensionType::MetadataPointer,
    ExtensionType::TokenMetadata,
    ExtensionType::GroupPointer,
    ExtensionType::TokenGroup,
    ExtensionType::GroupMemberPointer,
    ExtensionType::TokenGroupMember,
    ExtensionType::MintCloseAuthority,
    ExtensionType::InterestBearingConfig,
    ExtensionType::ScaledUiAmount,
];

/// Refused: a freeze authority, a mint close authority, and any Token-2022 extension not in the allowlist
/// (permanent delegate, transfer fee, transfer hook, default-frozen accounts, pausable, non-transferable,
/// confidential, ...).
pub fn check_mint(info: &AccountInfo, mint: &Mint) -> Result<()> {
    require!(mint.freeze_authority.is_none(), LotzError::UnsupportedMint);
    if *info.owner == spl_token_2022::ID {
        let data = info.try_borrow_data()?;
        let state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data)?;
        for extension in state.get_extension_types()? {
            require!(ALLOWED_MINT_EXTENSIONS.contains(&extension), LotzError::UnsupportedMint);
        }
        if let Ok(close) = state.get_extension::<MintCloseAuthority>() {
            require!(Option::<Pubkey>::from(close.close_authority).is_none(), LotzError::UnsupportedMint);
        }
    }
    Ok(())
}
