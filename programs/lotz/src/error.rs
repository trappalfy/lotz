use anchor_lang::prelude::*;

#[error_code]
pub enum LotzError {
    #[msg("Only the program's upgrade authority can initialize")]
    NotUpgradeAuthority,
    #[msg("Launch parameter out of range")]
    InvalidParams,
    #[msg("The token mint has an extension or authority that could move, freeze or tax locked tokens")]
    UnsupportedMint,
    #[msg("Only the admin can do this")]
    NotAdmin,
    #[msg("Only the ad's owner can do this")]
    NotAdOwner,
    #[msg("Buying is paused")]
    Paused,
    #[msg("Rectangle is outside the board")]
    RectOutOfBounds,
    #[msg("Rectangle is empty or larger than the limit")]
    RectTooLarge,
    #[msg("Link must be an https:// URL of printable ASCII, at most 200 bytes")]
    InvalidLink,
    #[msg("Image URI must be printable ASCII, 1 to 200 bytes")]
    InvalidImageUri,
    #[msg("Title must be at most 64 characters with no control characters")]
    InvalidTitle,
    #[msg("Image hash is missing")]
    MissingImageHash,
    #[msg("Epoch must be the current one or the next")]
    WrongEpoch,
    #[msg("Total price is above max_total")]
    SlippageExceeded,
    #[msg("You already own this lot")]
    OwnLot,
    #[msg("Shard accounts are missing, out of order or wrong")]
    WrongShards,
    #[msg("A previous ad of a taken lot is missing from the accounts")]
    PriorAdMissing,
    #[msg("Account is not a writable Lotz ad")]
    InvalidPriorAd,
    #[msg("The rectangle takes lots from too many ads; split the purchase")]
    TooManyPriorAds,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Ad still has live lots or an unclaimed refund")]
    AdNotEmpty,
    #[msg("This epoch is still locked")]
    StillLocked,
    #[msg("This epoch was already released")]
    AlreadyReleased,
    #[msg("Wrong treasury")]
    WrongTreasury,
    #[msg("Shard index out of range")]
    InvalidShardIndex,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("The board is retired")]
    Retired,
    #[msg("Retire the board first")]
    NotRetired,
    #[msg("Pause buying first")]
    NotPaused,
    #[msg("Ads or shards are still open")]
    StillOpen,
    #[msg("A refund is still owed on this ad; pay it out first")]
    RefundsUnpaid,
    #[msg("Account is not a Lotz shard")]
    NotAShard,
}
