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

// Time Constants
pub const SECONDS_IN_DAY: i64 = 86400;
pub const VIEW_RIGHTS_VALIDITY_SECONDS: i64 = 90 * SECONDS_IN_DAY; // 90 Days
pub const PINNER_AUDIT_WINDOW: i64 = 7 * SECONDS_IN_DAY; // 7 Days
pub const CLAIM_VAULT_VESTING_SECONDS: i64 = 6 * 30 * SECONDS_IN_DAY; // 6 months

// Fee Percentages (Basis Points)
pub const FEE_BASIS_POINTS: u16 = 1000; // 10%
pub const SPLIT_PINNER: u64 = 50;
pub const SPLIT_OWNER: u64 = 20;
pub const SPLIT_PERFORMER: u64 = 20;
pub const SPLIT_STAKERS: u64 = 10;
