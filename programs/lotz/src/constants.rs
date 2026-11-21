//! Seeds, board geometry and the parameters that are fixed in code (brief §2, §12).

pub const CONFIG_SEED: &[u8] = b"config";
pub const SHARD_SEED: &[u8] = b"shard";
pub const AD_SEED: &[u8] = b"ad";
pub const EPOCH_SEED: &[u8] = b"epoch";
pub const LOCK_VAULT_SEED: &[u8] = b"lock_vault";
pub const REFUND_VAULT_SEED: &[u8] = b"refund_vault";

/// The board is `BOARD_SIDE x BOARD_SIDE` lots (1000x1000 px, 10x10 px per lot).
pub const BOARD_SIDE: u16 = 100;
pub const TOTAL_LOTS: u16 = BOARD_SIDE * BOARD_SIDE;
/// A shard covers `SHARD_SIDE x SHARD_SIDE` lots; the board has `SHARDS_PER_SIDE^2` shards.
pub const SHARD_SIDE: u16 = 10;
pub const SHARDS_PER_SIDE: u16 = BOARD_SIDE / SHARD_SIDE;
pub const SHARD_COUNT: u16 = SHARDS_PER_SIDE * SHARDS_PER_SIDE;
pub const LOTS_PER_SHARD: usize = (SHARD_SIDE * SHARD_SIDE) as usize;

/// Hard cap for `Config.max_rect`: a rectangle no wider or taller than a shard touches at most 4 shards.
pub const MAX_RECT_LIMIT: u8 = SHARD_SIDE as u8;
pub const MAX_SHARDS_PER_BUY: usize = 4;

/// Previous ads one `buy` may take lots from (each is one more account in the transaction).
pub const MAX_PRIOR_ADS: usize = 16;

pub const BPS_DENOMINATOR: u128 = 10_000;
/// Fixed (brief §12): a takeover costs 1.5x the lot's last price.
pub const TAKEOVER_MULT_BPS: u16 = 15_000;
/// Fixed (brief §12): every payment into the lock unlocks 365 days after its weekly epoch ends.
pub const LOCK_PERIOD: i64 = 365 * DAY;
pub const EPOCH_LEN: i64 = 7 * DAY;
pub const DAY: i64 = 86_400;

/// Bounds for the launch parameters (checked once, in `initialize`).
pub const MIN_TIER_SIZE: u16 = 100;
pub const MIN_TIER_MULT_BPS: u16 = 10_000;
pub const MAX_TIER_MULT_BPS: u16 = 30_000;

pub const MAX_IMAGE_URI_LEN: usize = 200;
pub const MAX_LINK_LEN: usize = 200;
pub const MAX_TITLE_CHARS: usize = 64;
pub const LINK_SCHEME: &str = "https://";
