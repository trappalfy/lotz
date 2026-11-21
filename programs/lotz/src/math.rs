//! Prices (brief §2.3, §2.4). All arithmetic in u128 with checked ops, results narrowed to u64.
//! `packages/sdk/src/math.ts` mirrors these functions exactly; keep them in sync.
use anchor_lang::prelude::*;

use crate::{constants::BPS_DENOMINATOR, error::LotzError};

/// `floor(lots_sold / tier_size)`.
pub fn tier_of(lots_sold: u16, tier_size: u16) -> u16 {
    lots_sold / tier_size
}

/// Price of a free lot at `tier`: `base * (mult/10_000)^tier`, floored after every step so the result is the same
/// on every client.
pub fn tier_price(base_price: u64, tier_mult_bps: u16, tier: u16) -> Result<u64> {
    let mut price = u128::from(base_price);
    for _ in 0..tier {
        price = price
            .checked_mul(u128::from(tier_mult_bps))
            .and_then(|p| p.checked_div(BPS_DENOMINATOR))
            .ok_or(LotzError::MathOverflow)?;
    }
    u64::try_from(price).map_err(|_| error!(LotzError::MathOverflow))
}

/// Takeover price: `ceil(last_price * mult / 10_000)`.
pub fn takeover_price(last_price: u64, takeover_mult_bps: u16) -> Result<u64> {
    let product =
        u128::from(last_price).checked_mul(u128::from(takeover_mult_bps)).ok_or(LotzError::MathOverflow)?;
    let price = product
        .checked_add(BPS_DENOMINATOR - 1)
        .and_then(|p| p.checked_div(BPS_DENOMINATOR))
        .ok_or(LotzError::MathOverflow)?;
    u64::try_from(price).map_err(|_| error!(LotzError::MathOverflow))
}

/// Epoch `k` containing `now`: `floor((now - launch_ts) / epoch_len)`.
pub fn epoch_at(now: i64, launch_ts: i64, epoch_len: i64) -> Result<u32> {
    let elapsed = now.checked_sub(launch_ts).ok_or(LotzError::MathOverflow)?.max(0);
    let k = elapsed.checked_div(epoch_len).ok_or(LotzError::MathOverflow)?;
    u32::try_from(k).map_err(|_| error!(LotzError::MathOverflow))
}

/// `launch_ts + (k+1)*epoch_len + lock_period`.
pub fn unlock_at(k: u32, launch_ts: i64, epoch_len: i64, lock_period: i64) -> Result<i64> {
    i64::from(k)
        .checked_add(1)
        .and_then(|n| n.checked_mul(epoch_len))
        .and_then(|t| t.checked_add(launch_ts))
        .and_then(|t| t.checked_add(lock_period))
        .ok_or(error!(LotzError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_ladder() {
        let base = 1_000_000u64;
        let prices: Vec<u64> = (0..10).map(|t| tier_price(base, 12_500, t).unwrap()).collect();
        assert_eq!(prices[0], 1_000_000);
        assert_eq!(prices[1], 1_250_000);
        assert_eq!(prices[2], 1_562_500);
        assert_eq!(prices[9], 7_450_577); // ~7.45x (brief §2.3), floored per step
        assert_eq!(tier_of(999, 1000), 0);
        assert_eq!(tier_of(1000, 1000), 1);
        assert_eq!(tier_of(9999, 1000), 9);
    }

    #[test]
    fn takeover_rounds_up() {
        assert_eq!(takeover_price(100, 15_000).unwrap(), 150);
        assert_eq!(takeover_price(101, 15_000).unwrap(), 152); // 151.5 -> 152
        assert_eq!(takeover_price(1, 15_000).unwrap(), 2);
        assert!(takeover_price(u64::MAX, 15_000).is_err());
    }

    #[test]
    fn ladder_of_one_lot() {
        // 1x -> 1.5x -> 2.25x -> 3.38x -> 5.06x -> 7.59x -> 11.39x (brief §2.6)
        let mut p = 1_000_000u64;
        let mut ladder = vec![p];
        for _ in 0..6 {
            p = takeover_price(p, 15_000).unwrap();
            ladder.push(p);
        }
        assert_eq!(
            ladder,
            vec![1_000_000, 1_500_000, 2_250_000, 3_375_000, 5_062_500, 7_593_750, 11_390_625]
        );
    }

    #[test]
    fn epochs() {
        let launch = 1_000;
        assert_eq!(epoch_at(1_000, launch, 7).unwrap(), 0);
        assert_eq!(epoch_at(1_006, launch, 7).unwrap(), 0);
        assert_eq!(epoch_at(1_007, launch, 7).unwrap(), 1);
        assert_eq!(unlock_at(0, launch, 7, 365).unwrap(), 1_000 + 7 + 365);
        assert_eq!(unlock_at(3, launch, 7, 365).unwrap(), 1_000 + 28 + 365);
    }
}
