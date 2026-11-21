//! Test harness: LiteSVM with the built program, a token mint (SPL Token or Token-2022), a clock we control, and
//! builders for every instruction.
//!
//! Every transaction fee is paid by `env.payer`, a separate fee payer, so the buyers', owners' and treasury's
//! token balances move only by what the program moves.
#![allow(dead_code, clippy::result_large_err)]

use std::collections::HashMap;

use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{
        bpf_loader_upgradeable,
        instruction::{AccountMeta, Instruction},
    },
    AccountDeserialize, AnchorDeserialize, InstructionData, ToAccountMetas,
};
use base64::Engine;
use litesvm::{
    types::{TransactionMetadata, TransactionResult},
    LiteSVM,
};
use lotz::{
    accounts, instruction,
    math::{epoch_at, takeover_price, tier_of, tier_price},
    shard_index_of, shards_for_rect,
    state::{Ad, Config, LockEpoch, Lot, Shard},
    BuyArgs, InitParams, AD_SEED, CONFIG_SEED, EPOCH_SEED, LOCK_VAULT_SEED, REFUND_VAULT_SEED, SHARD_SEED,
};
use solana_account::Account;
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use spl_token_2022_interface::extension::{ExtensionType, StateWithExtensions};

pub const DECIMALS: u8 = 6;
pub const TOKEN: u64 = 1_000_000;
/// Tier-0 price of a free lot in the tests: 1,000 tokens.
pub const BASE_PRICE: u64 = 1_000 * TOKEN;
pub const DAY: i64 = 86_400;
pub const WEEK: i64 = 7 * DAY;
pub const YEAR: i64 = 365 * DAY;
/// Unix time the tests start at.
pub const START: i64 = 1_800_000_000;
pub const SOL: u64 = 1_000_000_000;

pub const TOKEN_PROGRAM: Pubkey = spl_token_interface::ID;
pub const TOKEN_2022_PROGRAM: Pubkey = spl_token_2022_interface::ID;
pub const ATA_PROGRAM: Pubkey = spl_associated_token_account_interface::program::ID;
pub const SYSTEM_PROGRAM: Pubkey = anchor_lang::system_program::ID;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MintKind {
    /// Classic SPL Token, no freeze authority.
    Spl,
    /// Classic SPL Token with a freeze authority (refused by `initialize`).
    SplWithFreeze,
    /// Token-2022 with a metadata pointer, like a launchpad coin.
    Token2022Metadata,
    /// Token-2022 with a permanent delegate (refused).
    Token2022PermanentDelegate,
    /// Token-2022 with a transfer fee (refused).
    Token2022TransferFee,
    /// Token-2022 with a mint close authority (refused: the mint could be closed and re-created).
    Token2022CloseAuthority,
    /// Token-2022 with the close-authority extension but no authority set (accepted).
    Token2022CloseAuthorityNone,
}

pub fn default_params() -> InitParams {
    InitParams {
        base_price: BASE_PRICE,
        tier_size: 1_000,
        tier_mult_bps: 12_500,
        max_rect: 10,
        paused: false,
    }
}

pub struct Env {
    pub svm: LiteSVM,
    /// Pays every transaction fee (never an actor).
    pub payer: Keypair,
    /// Upgrade authority of the program and admin of the config.
    pub admin: Keypair,
    pub mint_authority: Keypair,
    /// The treasury wallet.
    pub treasury: Keypair,
    pub mint: Pubkey,
    pub mint_kind: MintKind,
    pub token_program: Pubkey,
    /// ad_id -> ad address, for every ad created through this harness.
    pub ads: HashMap<u64, Pubkey>,
    next_nonce: u64,
}

// ---------------------------------------------------------------- addresses

pub fn program_id() -> Pubkey {
    lotz::ID
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &program_id()).0
}

pub fn config_pda() -> Pubkey {
    pda(&[CONFIG_SEED])
}

pub fn lock_vault() -> Pubkey {
    pda(&[LOCK_VAULT_SEED])
}

pub fn refund_vault() -> Pubkey {
    pda(&[REFUND_VAULT_SEED])
}

pub fn shard_pda(index: u8) -> Pubkey {
    pda(&[SHARD_SEED, &[index]])
}

pub fn epoch_pda(k: u32) -> Pubkey {
    pda(&[EPOCH_SEED, &k.to_le_bytes()])
}

pub fn ad_pda(owner: &Pubkey, nonce: u64) -> Pubkey {
    pda(&[AD_SEED, owner.as_ref(), &nonce.to_le_bytes()])
}

pub fn program_data() -> Pubkey {
    Pubkey::find_program_address(&[program_id().as_ref()], &bpf_loader_upgradeable::ID).0
}

pub fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction::new_with_bytes(program_id(), &data.data(), accounts.to_account_metas(None))
}

// ---------------------------------------------------------------- results

pub fn assert_ok(res: TransactionResult) -> TransactionMetadata {
    match res {
        Ok(meta) => meta,
        Err(failed) => panic!("transaction failed: {:?}. Logs:\n{}", failed.err, failed.meta.logs.join("\n")),
    }
}

/// The transaction failed with this custom error code.
pub fn assert_code(res: TransactionResult, code: u32) {
    match res {
        Ok(meta) => {
            panic!("expected error {code}, but the transaction succeeded. Logs:\n{}", meta.logs.join("\n"))
        }
        Err(failed) => match &failed.err {
            TransactionError::InstructionError(_, InstructionError::Custom(got)) => {
                assert_eq!(*got, code, "wrong error code. Logs:\n{}", failed.meta.logs.join("\n"))
            }
            other => {
                panic!("expected custom error {code}, got {other:?}. Logs:\n{}", failed.meta.logs.join("\n"))
            }
        },
    }
}

pub fn assert_lotz_err(res: TransactionResult, err: lotz::error::LotzError) {
    assert_code(res, u32::from(err));
}

pub fn assert_anchor_err(res: TransactionResult, err: anchor_lang::error::ErrorCode) {
    assert_code(res, err as u32);
}

/// The transaction failed, whatever the reason; returns the logs.
pub fn assert_fails(res: TransactionResult) -> String {
    match res {
        Ok(meta) => {
            panic!("expected failure, but the transaction succeeded. Logs:\n{}", meta.logs.join("\n"))
        }
        Err(failed) => failed.meta.logs.join("\n"),
    }
}

// ---------------------------------------------------------------- events

/// Decodes every `emit!` event of type `E` from the transaction's logs (`Program data: <base64>`).
pub fn events<E>(meta: &TransactionMetadata) -> Vec<E>
where
    E: anchor_lang::Event + AnchorDeserialize,
{
    meta.logs
        .iter()
        .filter_map(|line| line.strip_prefix("Program data: "))
        .filter_map(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .filter_map(|bytes| {
            let body = bytes.strip_prefix(E::DISCRIMINATOR)?;
            Some(E::try_from_slice(body).expect("event decodes"))
        })
        .collect()
}

pub fn one_event<E>(meta: &TransactionMetadata) -> E
where
    E: anchor_lang::Event + AnchorDeserialize,
{
    let mut all = events::<E>(meta);
    assert_eq!(all.len(), 1, "expected exactly one event");
    all.pop().unwrap()
}

// ---------------------------------------------------------------- content

pub fn content_args(nonce: u64, x: u8, y: u8, w: u8, h: u8, epoch: u32) -> BuyArgs {
    BuyArgs {
        nonce,
        x,
        y,
        w,
        h,
        epoch,
        max_total: u64::MAX,
        image_hash: [7; 32],
        image_uri: format!("https://cdn.lotz.local/i/{nonce}.webp"),
        link: "https://example.com/your-coin".to_string(),
        title: "your coin".to_string(),
    }
}

/// What a rectangle costs right now, computed from the shards: `(total, refunds, free_lots, taken_lots)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quote {
    pub total: u64,
    pub refunds: u64,
    pub locked: u64,
    pub free_lots: u16,
    pub taken_lots: u16,
}

// ---------------------------------------------------------------- environment

impl Env {
    /// SPL Token mint, default parameters, config initialised, all 100 shards created.
    pub fn new() -> Self {
        Self::with(MintKind::Spl, default_params())
    }

    pub fn with(kind: MintKind, params: InitParams) -> Self {
        let mut env = Self::bare(kind);
        let admin = env.admin.insecure_clone();
        assert_ok(env.try_initialize(&admin, params));
        env.init_all_shards();
        env
    }

    /// Program loaded (admin = upgrade authority) and mint in place, but no config yet.
    pub fn bare(kind: MintKind) -> Self {
        let mut svm = LiteSVM::new();
        let so_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/lotz.so");
        let bytes = std::fs::read(so_path)
            .unwrap_or_else(|e| panic!("{so_path}: {e}. Run `anchor build` before `cargo test`."));
        svm.add_program(program_id(), &bytes).unwrap();

        let payer = Keypair::new();
        let admin = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10_000 * SOL).unwrap();
        svm.airdrop(&admin.pubkey(), 100 * SOL).unwrap();

        let token_program = match kind {
            MintKind::Spl | MintKind::SplWithFreeze => TOKEN_PROGRAM,
            _ => TOKEN_2022_PROGRAM,
        };
        let mut env = Self {
            svm,
            payer,
            admin,
            mint_authority: Keypair::new(),
            treasury: Keypair::new(),
            mint: Pubkey::default(),
            mint_kind: kind,
            token_program,
            ads: HashMap::new(),
            next_nonce: 1,
        };
        env.set_time(START);
        env.set_upgrade_authority(Some(env.admin.pubkey()));
        env.mint = env.create_mint(kind);
        env
    }

    /// LiteSVM loads the program with no upgrade authority; write one into the ProgramData header.
    /// Layout (bincode): u32 variant (3 = ProgramData), u64 slot, u8 option tag, 32-byte authority.
    pub fn set_upgrade_authority(&mut self, authority: Option<Pubkey>) {
        let address = program_data();
        let mut account = self.svm.get_account(&address).expect("programdata");
        assert_eq!(&account.data[0..4], &[3, 0, 0, 0], "not a ProgramData account");
        match authority {
            Some(key) => {
                account.data[12] = 1;
                account.data[13..45].copy_from_slice(key.as_ref());
            }
            None => {
                account.data[12] = 0;
                account.data[13..45].fill(0);
            }
        }
        self.svm.set_account(address, account).unwrap();
    }

    fn create_mint(&mut self, kind: MintKind) -> Pubkey {
        let mint = Keypair::new();
        let authority = self.mint_authority.pubkey();
        match kind {
            MintKind::Spl | MintKind::SplWithFreeze => {
                let mut data = vec![0u8; spl_token_interface::state::Mint::LEN];
                spl_token_interface::state::Mint {
                    mint_authority: COption::Some(authority),
                    supply: 0,
                    decimals: DECIMALS,
                    is_initialized: true,
                    freeze_authority: if kind == MintKind::SplWithFreeze {
                        COption::Some(authority)
                    } else {
                        COption::None
                    },
                }
                .pack_into_slice(&mut data);
                let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
                self.svm
                    .set_account(
                        mint.pubkey(),
                        Account { lamports, data, owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 },
                    )
                    .unwrap();
            }
            _ => {
                let extension = match kind {
                    MintKind::Token2022Metadata => ExtensionType::MetadataPointer,
                    MintKind::Token2022PermanentDelegate => ExtensionType::PermanentDelegate,
                    MintKind::Token2022TransferFee => ExtensionType::TransferFeeConfig,
                    MintKind::Token2022CloseAuthority | MintKind::Token2022CloseAuthorityNone => {
                        ExtensionType::MintCloseAuthority
                    }
                    _ => unreachable!(),
                };
                let space =
                    ExtensionType::try_calculate_account_len::<spl_token_2022_interface::state::Mint>(&[
                        extension,
                    ])
                    .unwrap();
                let lamports = self.svm.minimum_balance_for_rent_exemption(space);
                let create = solana_system_interface::instruction::create_account(
                    &self.payer.pubkey(),
                    &mint.pubkey(),
                    lamports,
                    space as u64,
                    &TOKEN_2022_PROGRAM,
                );
                let init_extension = match kind {
                    MintKind::Token2022Metadata => {
                        spl_token_2022_interface::extension::metadata_pointer::instruction::initialize(
                            &TOKEN_2022_PROGRAM,
                            &mint.pubkey(),
                            Some(authority),
                            Some(mint.pubkey()),
                        )
                        .unwrap()
                    }
                    MintKind::Token2022PermanentDelegate => {
                        spl_token_2022_interface::instruction::initialize_permanent_delegate(
                            &TOKEN_2022_PROGRAM,
                            &mint.pubkey(),
                            &authority,
                        )
                        .unwrap()
                    }
                    MintKind::Token2022TransferFee => {
                        spl_token_2022_interface::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                            &TOKEN_2022_PROGRAM,
                            &mint.pubkey(),
                            Some(&authority),
                            Some(&authority),
                            100,
                            u64::MAX,
                        )
                        .unwrap()
                    }
                    MintKind::Token2022CloseAuthority => spl_token_2022_interface::instruction::initialize_mint_close_authority(
                        &TOKEN_2022_PROGRAM,
                        &mint.pubkey(),
                        Some(&authority),
                    )
                    .unwrap(),
                    MintKind::Token2022CloseAuthorityNone => {
                        spl_token_2022_interface::instruction::initialize_mint_close_authority(
                            &TOKEN_2022_PROGRAM,
                            &mint.pubkey(),
                            None,
                        )
                        .unwrap()
                    }
                    _ => unreachable!(),
                };
                let init_mint = spl_token_2022_interface::instruction::initialize_mint2(
                    &TOKEN_2022_PROGRAM,
                    &mint.pubkey(),
                    &authority,
                    None,
                    DECIMALS,
                )
                .unwrap();
                assert_ok(self.send(&[create, init_extension, init_mint], &[&mint]));
            }
        }
        mint.pubkey()
    }

    /// Sends one transaction, fee paid by `self.payer`, then moves to a fresh blockhash so an identical
    /// transaction later in the test is not deduplicated.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TransactionResult {
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&self.payer.pubkey()),
            &all,
            self.svm.latest_blockhash(),
        );
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    // ------------------------------------------------------------ clock

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    pub fn advance(&mut self, seconds: i64) {
        let now = self.now();
        self.set_time(now + seconds);
    }

    pub fn current_epoch(&self) -> u32 {
        let c = self.config();
        epoch_at(self.now(), c.launch_ts, c.epoch_len).unwrap()
    }

    // ------------------------------------------------------------ wallets and tokens

    pub fn wallet(&mut self) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10 * SOL).unwrap();
        kp
    }

    /// A wallet with an ATA holding `amount` base units.
    pub fn funded(&mut self, amount: u64) -> Keypair {
        let kp = self.wallet();
        let ata = self.create_ata(&kp.pubkey());
        if amount > 0 {
            self.mint_to(&ata, amount);
        }
        kp
    }

    pub fn ata(&self, owner: &Pubkey) -> Pubkey {
        spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
            owner,
            &self.mint,
            &self.token_program,
        )
    }

    pub fn create_ata(&mut self, owner: &Pubkey) -> Pubkey {
        let ix = spl_associated_token_account_interface::instruction::create_associated_token_account(
            &self.payer.pubkey(),
            owner,
            &self.mint,
            &self.token_program,
        );
        assert_ok(self.send(&[ix], &[]));
        self.ata(owner)
    }

    pub fn mint_to(&mut self, to: &Pubkey, amount: u64) {
        let authority = self.mint_authority.insecure_clone();
        let ix = spl_token_2022_interface::instruction::mint_to(
            &self.token_program,
            &self.mint,
            to,
            &authority.pubkey(),
            &[],
            amount,
        )
        .unwrap();
        assert_ok(self.send(&[ix], &[&authority]));
    }

    pub fn token_balance(&self, token_account: &Pubkey) -> u64 {
        match self.svm.get_account(token_account) {
            Some(account) if !account.data.is_empty() => {
                StateWithExtensions::<spl_token_2022_interface::state::Account>::unpack(&account.data)
                    .unwrap()
                    .base
                    .amount
            }
            _ => 0,
        }
    }

    /// Tokens in `owner`'s ATA (0 if it does not exist).
    pub fn tokens(&self, owner: &Pubkey) -> u64 {
        self.token_balance(&self.ata(owner))
    }

    pub fn lock_balance(&self) -> u64 {
        self.token_balance(&lock_vault())
    }

    pub fn refund_balance(&self) -> u64 {
        self.token_balance(&refund_vault())
    }

    pub fn lamports(&self, address: &Pubkey) -> u64 {
        self.svm.get_account(address).map(|a| a.lamports).unwrap_or(0)
    }

    pub fn exists(&self, address: &Pubkey) -> bool {
        self.svm.get_account(address).is_some_and(|a| a.lamports > 0)
    }

    // ------------------------------------------------------------ program state

    fn decode<T: AccountDeserialize>(&self, address: &Pubkey) -> T {
        let account = self.svm.get_account(address).unwrap_or_else(|| panic!("account {address} missing"));
        T::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn config(&self) -> Config {
        self.decode(&config_pda())
    }

    pub fn ad(&self, address: &Pubkey) -> Ad {
        self.decode(address)
    }

    pub fn ad_by_id(&self, ad_id: u64) -> Ad {
        self.ad(&self.ads[&ad_id])
    }

    pub fn lock_epoch(&self, k: u32) -> LockEpoch {
        self.decode(&epoch_pda(k))
    }

    pub fn shard(&self, index: u8) -> Shard {
        let account = self.svm.get_account(&shard_pda(index)).expect("shard exists");
        bytemuck::pod_read_unaligned::<Shard>(&account.data[8..8 + std::mem::size_of::<Shard>()])
    }

    pub fn lot(&self, lx: u16, ly: u16) -> Lot {
        let shard = self.shard(shard_index_of(lx, ly));
        shard.lots[lotz::lot_offset(lx, ly)]
    }

    /// Prices a rectangle from the current shard state, independently of the program's transaction.
    pub fn quote(&self, x: u8, y: u8, w: u8, h: u8) -> Quote {
        let c = self.config();
        let free = tier_price(c.base_price, c.tier_mult_bps, tier_of(c.lots_sold, c.tier_size)).unwrap();
        let mut q = Quote { total: 0, refunds: 0, locked: 0, free_lots: 0, taken_lots: 0 };
        for ly in u16::from(y)..u16::from(y) + u16::from(h) {
            for lx in u16::from(x)..u16::from(x) + u16::from(w) {
                let lot = self.lot(lx, ly);
                if lot.ad_id == 0 {
                    q.free_lots += 1;
                    q.total += free;
                } else {
                    q.taken_lots += 1;
                    q.total += takeover_price(lot.last_price, c.takeover_mult_bps).unwrap();
                    q.refunds += lot.last_price;
                }
            }
        }
        q.locked = q.total - q.refunds;
        q
    }

    /// Ads (by address) that own a lot in the rectangle.
    pub fn prior_ads(&self, x: u8, y: u8, w: u8, h: u8) -> Vec<Pubkey> {
        let mut ids: Vec<u64> = vec![];
        for ly in u16::from(y)..u16::from(y) + u16::from(h) {
            for lx in u16::from(x)..u16::from(x) + u16::from(w) {
                let id = self.lot(lx, ly).ad_id;
                if id != 0 && !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        ids.iter().map(|id| self.ads[id]).collect()
    }

    // ------------------------------------------------------------ instructions

    pub fn initialize_ix(&self, admin: &Pubkey, params: InitParams) -> Instruction {
        ix(
            accounts::Initialize {
                admin: *admin,
                config: config_pda(),
                token_mint: self.mint,
                treasury: self.treasury.pubkey(),
                lock_vault: lock_vault(),
                refund_vault: refund_vault(),
                lotz_program: program_id(),
                program_data: program_data(),
                token_program: self.token_program,
                system_program: SYSTEM_PROGRAM,
            },
            instruction::Initialize { params },
        )
    }

    pub fn try_initialize(&mut self, admin: &Keypair, params: InitParams) -> TransactionResult {
        let ix = self.initialize_ix(&admin.pubkey(), params);
        self.send(&[ix], &[admin])
    }

    pub fn init_shard_ix(&self, admin: &Pubkey, index: u8) -> Instruction {
        ix(
            accounts::InitShard {
                admin: *admin,
                config: config_pda(),
                shard: shard_pda(index),
                system_program: SYSTEM_PROGRAM,
            },
            instruction::InitShard { index },
        )
    }

    pub fn init_all_shards(&mut self) {
        let admin = self.admin.insecure_clone();
        for batch in 0..10u8 {
            let ixs: Vec<Instruction> =
                (0..10u8).map(|i| self.init_shard_ix(&admin.pubkey(), batch * 10 + i)).collect();
            assert_ok(self.send(&ixs, &[&admin]));
        }
    }

    pub fn next_nonce(&mut self) -> u64 {
        self.next_nonce += 1;
        self.next_nonce
    }

    /// Default content for a rectangle, current epoch, no price cap.
    pub fn args(&mut self, x: u8, y: u8, w: u8, h: u8) -> BuyArgs {
        let nonce = self.next_nonce();
        let epoch = self.current_epoch();
        content_args(nonce, x, y, w, h, epoch)
    }

    /// A `buy` instruction with explicit shard and prior-ad accounts.
    pub fn buy_ix_with(
        &self,
        buyer: &Pubkey,
        args: &BuyArgs,
        shards: &[Pubkey],
        prior: &[Pubkey],
    ) -> Instruction {
        let mut ix = ix(
            accounts::Buy {
                buyer: *buyer,
                config: config_pda(),
                token_mint: self.mint,
                buyer_token: self.ata(buyer),
                lock_vault: lock_vault(),
                refund_vault: refund_vault(),
                lock_epoch: epoch_pda(args.epoch),
                ad: ad_pda(buyer, args.nonce),
                token_program: self.token_program,
                system_program: SYSTEM_PROGRAM,
            },
            instruction::Buy { args: args.clone() },
        );
        ix.accounts.extend(shards.iter().map(|k| AccountMeta::new(*k, false)));
        ix.accounts.extend(prior.iter().map(|k| AccountMeta::new(*k, false)));
        ix
    }

    /// A `buy` instruction with the right shards and prior ads for the current state.
    pub fn buy_ix(&self, buyer: &Pubkey, args: &BuyArgs) -> Instruction {
        let (needed, n) = shards_for_rect(args.x, args.y, args.w.max(1), args.h.max(1));
        let shards: Vec<Pubkey> = needed[..n].iter().map(|&i| shard_pda(i)).collect();
        let prior = if args.w == 0
            || args.h == 0
            || u16::from(args.x) + u16::from(args.w) > 100
            || u16::from(args.y) + u16::from(args.h) > 100
        {
            vec![]
        } else {
            self.prior_ads(args.x, args.y, args.w, args.h)
        };
        self.buy_ix_with(buyer, args, &shards, &prior)
    }

    pub fn try_buy_args(&mut self, buyer: &Keypair, args: &BuyArgs) -> TransactionResult {
        let ix = self.buy_ix(&buyer.pubkey(), args);
        let budget = compute_budget(1_400_000);
        let next_id = self.config().next_ad_id;
        let res = self.send(&[budget, ix], &[buyer]);
        if res.is_ok() {
            self.ads.insert(next_id, ad_pda(&buyer.pubkey(), args.nonce));
        }
        res
    }

    pub fn try_buy(&mut self, buyer: &Keypair, x: u8, y: u8, w: u8, h: u8) -> TransactionResult {
        let args = self.args(x, y, w, h);
        self.try_buy_args(buyer, &args)
    }

    /// Buys and returns the new ad's id.
    pub fn buy(&mut self, buyer: &Keypair, x: u8, y: u8, w: u8, h: u8) -> u64 {
        let id = self.config().next_ad_id;
        assert_ok(self.try_buy(buyer, x, y, w, h));
        id
    }

    pub fn claim_ix(&self, owner: &Pubkey, ad: &Pubkey) -> Instruction {
        ix(
            accounts::ClaimRefund {
                owner: *owner,
                config: config_pda(),
                token_mint: self.mint,
                ad: *ad,
                refund_vault: refund_vault(),
                owner_token: self.ata(owner),
                token_program: self.token_program,
                associated_token_program: ATA_PROGRAM,
                system_program: SYSTEM_PROGRAM,
            },
            instruction::ClaimRefund {},
        )
    }

    pub fn try_claim(&mut self, owner: &Keypair, ad_id: u64) -> TransactionResult {
        let ix = self.claim_ix(&owner.pubkey(), &self.ads[&ad_id]);
        self.send(&[ix], &[owner])
    }

    pub fn close_ix(&self, owner: &Pubkey, ad: &Pubkey) -> Instruction {
        ix(accounts::CloseAd { owner: *owner, ad: *ad }, instruction::CloseAd {})
    }

    pub fn try_close(&mut self, owner: &Keypair, ad_id: u64) -> TransactionResult {
        let ix = self.close_ix(&owner.pubkey(), &self.ads[&ad_id]);
        self.send(&[ix], &[owner])
    }

    pub fn release_ix(&self, caller: &Pubkey, epoch: u32) -> Instruction {
        ix(
            accounts::ReleaseEpoch {
                caller: *caller,
                config: config_pda(),
                token_mint: self.mint,
                lock_epoch: epoch_pda(epoch),
                lock_vault: lock_vault(),
                treasury: self.treasury.pubkey(),
                treasury_token: self.ata(&self.treasury.pubkey()),
                token_program: self.token_program,
                associated_token_program: ATA_PROGRAM,
                system_program: SYSTEM_PROGRAM,
            },
            instruction::ReleaseEpoch { epoch },
        )
    }

    pub fn try_release(&mut self, caller: &Keypair, epoch: u32) -> TransactionResult {
        let ix = self.release_ix(&caller.pubkey(), epoch);
        self.send(&[ix], &[caller])
    }

    pub fn set_paused_ix(&self, admin: &Pubkey, paused: bool) -> Instruction {
        ix(accounts::SetPaused { admin: *admin, config: config_pda() }, instruction::SetPaused { paused })
    }

    pub fn try_set_paused(&mut self, admin: &Keypair, paused: bool) -> TransactionResult {
        let ix = self.set_paused_ix(&admin.pubkey(), paused);
        self.send(&[ix], &[admin])
    }
}

pub fn compute_budget(units: u32) -> Instruction {
    // ComputeBudgetInstruction::SetComputeUnitLimit = discriminant 2, then u32 LE.
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction::new_with_bytes(
        anchor_lang::pubkey!("ComputeBudget111111111111111111111111111111"),
        &data,
        vec![],
    )
}
