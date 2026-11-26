//! Random sequences of purchases, takeovers and claims; after every step the accounting must hold exactly:
//!
//! - the lock vault holds the sum of the current prices of all sold lots (brief §2.6);
//! - the refund vault holds the sum of unclaimed refunds;
//! - every wallet has paid, net of refunds, exactly the current prices of the lots it holds now;
//! - each ad's `lots_alive` matches the shards, `lots_sold` matches the lots ever sold.
mod common;

use std::collections::HashMap;

use common::*;
use lotz::error::LotzError;
use proptest::prelude::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[derive(Debug, Clone)]
enum Op {
    Buy { who: usize, x: u8, y: u8, w: u8, h: u8 },
    Claim { who: usize },
    Wait { days: i64 },
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        6 => (0..4usize, 0..14u8, 0..14u8, 1..5u8, 1..5u8).prop_map(|(who, x, y, w, h)| Op::Buy { who, x, y, w, h }),
        2 => (0..4usize).prop_map(|who| Op::Claim { who }),
        1 => (1..10i64).prop_map(|days| Op::Wait { days }),
    ]
}

const FUNDS: u64 = 10_000_000_000 * TOKEN;

fn check(env: &Env, wallets: &[Keypair]) {
    let shards: Vec<_> = (0..100u8).map(|i| env.shard(i)).collect();
    let lots: Vec<_> = shards.iter().flat_map(|s| s.lots).collect();
    let c = env.config();

    let sum_prices: u64 = lots.iter().map(|l| l.last_price).sum();
    assert_eq!(env.lock_balance(), sum_prices, "lock = sum of current prices");
    assert_eq!(c.total_locked - c.total_released, sum_prices);
    assert_eq!(u64::from(c.lots_sold), lots.iter().filter(|l| l.ad_id != 0).count() as u64);

    let mut alive: HashMap<u64, u16> = HashMap::new();
    let mut held_value: HashMap<u64, u64> = HashMap::new();
    for l in lots.iter().filter(|l| l.ad_id != 0) {
        *alive.entry(l.ad_id).or_default() += 1;
        *held_value.entry(l.ad_id).or_default() += l.last_price;
    }
    let mut refunds_due = 0u64;
    let mut net_by_owner: HashMap<_, u64> = HashMap::new();
    for (&id, addr) in &env.ads {
        let ad = env.ad(addr);
        assert_eq!(ad.lots_alive, alive.get(&id).copied().unwrap_or(0), "ad {id} lots_alive");
        refunds_due += ad.refund_due;
        *net_by_owner.entry(ad.owner).or_default() += held_value.get(&id).copied().unwrap_or(0);
    }
    assert_eq!(env.refund_balance(), refunds_due, "refund vault = unclaimed refunds");
    let existing = env.ads.values().filter(|a| env.exists(a)).count() as u32;
    assert_eq!(c.ads_open, existing, "ads_open = ads that exist");

    for w in wallets {
        let owned: u64 = net_by_owner.get(&w.pubkey()).copied().unwrap_or(0);
        let due: u64 =
            env.ads.values().map(|a| env.ad(a)).filter(|a| a.owner == w.pubkey()).map(|a| a.refund_due).sum();
        let spent_net = FUNDS - env.tokens(&w.pubkey()) - due;
        assert_eq!(spent_net, owned, "a wallet pays only for the lots it holds now");
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, .. ProptestConfig::default() })]

    #[test]
    fn accounting_holds(ops in prop::collection::vec(op(), 1..40)) {
        let mut env = Env::new();
        let wallets: Vec<_> = (0..4).map(|_| env.funded(FUNDS)).collect();
        for op in ops {
            match op {
                Op::Buy { who, x, y, w, h } => {
                    let buyer = wallets[who].insecure_clone();
                    let own = env.prior_ads(x, y, w, h).iter().any(|a| env.ad(a).owner == buyer.pubkey());
                    let q = env.quote(x, y, w, h);
                    let lock_before = env.lock_balance();
                    let res = env.try_buy(&buyer, x, y, w, h);
                    if own {
                        assert_lotz_err(res, LotzError::OwnLot);
                    } else {
                        assert_ok(res);
                        prop_assert_eq!(env.lock_balance() - lock_before, q.locked);
                    }
                }
                Op::Claim { who } => {
                    let owner = wallets[who].insecure_clone();
                    let ids: Vec<u64> = env.ads.iter()
                        .filter(|(_, a)| { let ad = env.ad(a); ad.owner == owner.pubkey() && ad.refund_due > 0 })
                        .map(|(id, _)| *id).collect();
                    for id in ids {
                        assert_ok(env.try_claim(&owner, id));
                    }
                }
                Op::Wait { days } => env.advance(days * DAY),
            }
            check(&env, &wallets);
        }
        // Every epoch's amount adds up to the total locked.
        let c = env.config();
        let k_max = env.current_epoch();
        let sum: u64 = (0..=k_max + 1).filter(|k| env.exists(&epoch_pda(*k))).map(|k| env.lock_epoch(k).amount).sum();
        prop_assert_eq!(sum, c.total_locked);
    }
}
