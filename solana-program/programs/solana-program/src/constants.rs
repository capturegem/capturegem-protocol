// solana-program/programs/solana-program/src/constants.rs
use anchor_lang::prelude::*;

#[constant]
pub const SEED_GLOBAL_STATE: &[u8] = b"global_state";

#[constant]
pub const SEED_USER_ACCOUNT: &[u8] = b"user_account";

#[constant]
pub const SEED_COLLECTION_STATE: &[u8] = b"collection_state";

#[constant]
pub const SEED_VIEW_RIGHT: &[u8] = b"view_right";

#[constant]
pub const SEED_PINNER_BOND: &[u8] = b"host_bond";

#[constant]
pub const SEED_PERFORMER_ESCROW: &[u8] = b"performer_escrow";

#[constant]
pub const SEED_ACCESS_ESCROW: &[u8] = b"access_escrow";

#[constant]
pub const SEED_CLAIM_VAULT: &[u8] = b"claim_vault";

#[constant]
pub const SEED_PEER_TRUST: &[u8] = b"peer_trust";

#[constant]
pub const SEED_CID_REVEAL: &[u8] = b"cid_reveal";

#[constant]
pub const SEED_STAKING_POOL: &[u8] = b"staking_pool";

#[constant]
pub const SEED_STAKER_POSITION: &[u8] = b"staker_position";

// Time Constants
pub const SECONDS_IN_DAY: i64 = 86400;
pub const VIEW_RIGHTS_VALIDITY_SECONDS: i64 = 90 * SECONDS_IN_DAY; // 90 Days
pub const CLAIM_VAULT_VESTING_SECONDS: i64 = 6 * 30 * SECONDS_IN_DAY; // 6 months
pub const ESCROW_EXPIRY_SECONDS: i64 = 24 * 3600; // 24 hours

// Purchase Split (50/50 between stakers and peers escrow)
pub const SPLIT_TO_STAKERS: u64 = 50; // 50% to collection token stakers
pub const SPLIT_TO_PEERS_ESCROW: u64 = 50; // 50% to peers escrow

// Fee Percentages (Basis Points) - Legacy, kept for backward compatibility
pub const FEE_BASIS_POINTS: u16 = 1000; // 10%
pub const SPLIT_PINNER: u64 = 50;
pub const SPLIT_OWNER: u64 = 20;
pub const SPLIT_PERFORMER: u64 = 20;
pub const SPLIT_STAKERS: u64 = 10;

// Precision for reward calculations
pub const REWARD_PRECISION: u128 = 1_000_000_000_000; // 1e12
