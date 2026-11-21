/** Board geometry and fixed parameters. Mirrors programs/lotz/src/constants.rs. */

/** Lots per board side (100 x 100 lots = 10,000). */
export const BOARD_SIDE = 100;
export const TOTAL_LOTS = BOARD_SIDE * BOARD_SIDE;
/** Logical pixels per lot side (a lot is 10 x 10 px). */
export const LOT_PX = 10;
/** Logical pixels per board side (1000). */
export const BOARD_PX = BOARD_SIDE * LOT_PX;
/** Lots per shard side; the board has 10 x 10 shards. */
export const SHARD_SIDE = 10;
export const SHARDS_PER_SIDE = BOARD_SIDE / SHARD_SIDE;
export const SHARD_COUNT = SHARDS_PER_SIDE * SHARDS_PER_SIDE;
export const LOTS_PER_SHARD = SHARD_SIDE * SHARD_SIDE;

/** Hard cap for a rectangle side (the config's `max_rect` is at most this). */
export const MAX_RECT_LIMIT = 10;
/** Previous ads one purchase may take lots from. */
export const MAX_PRIOR_ADS = 16;

export const BPS = 10_000n;
export const TAKEOVER_MULT_BPS = 15_000;
export const DAY = 86_400;
export const EPOCH_LEN = 7 * DAY;
export const LOCK_PERIOD = 365 * DAY;

export const MAX_IMAGE_URI_LEN = 200;
export const MAX_LINK_LEN = 200;
export const MAX_TITLE_CHARS = 64;
export const LINK_SCHEME = "https://";

/** Uploaded images are stored at this many pixels per logical pixel (crisp when zoomed). */
export const IMAGE_SCALE = 4;

/** Solana's packet limit for a serialized transaction. */
export const MAX_TX_BYTES = 1232;

export const SEEDS = {
  config: "config",
  shard: "shard",
  ad: "ad",
  epoch: "epoch",
  lockVault: "lock_vault",
  refundVault: "refund_vault",
} as const;
