// solana-program/programs/solana-program/src/state.rs
use anchor_lang::prelude::*;

#[account]
pub struct GlobalState {
    pub admin: Pubkey,
    pub indexer_api_url: String, // Limit length in real impl
    pub node_registry_url: String,
    pub moderator_stake_minimum: u64,
    pub bump: u8,
}

impl GlobalState {
    pub const MAX_SIZE: usize = 8 + 32 + (4 + 64) + (4 + 64) + 8 + 1; 
}

#[account]
pub struct UserAccount {
    pub authority: Pubkey,
    pub ipns_key: String, // Points to off-chain metadata
    pub is_online: bool,
    pub bump: u8,
}

impl UserAccount {
    // discriminator + 32 pubkey + (4 prefix + 64 string) + 1 bool + 1 bump
    pub const MAX_SIZE: usize = 8 + 32 + 68 + 1 + 1;
}

#[account]
pub struct CollectionState {
    pub owner: Pubkey,
    pub collection_id: String,
    pub collection_token_mint: Pubkey,
    pub oracle_feed: Pubkey,
    pub access_threshold_usd: u64, // Stored with fixed precision (e.g. 2 decimals)
    pub max_video_limit: u32,
    pub video_count: u32,
    pub reward_pool_balance: u64,
    pub bump: u8,
}

impl CollectionState {
    pub const MAX_SIZE: usize = 8 + 32 + (4 + 32) + 32 + 32 + 8 + 4 + 4 + 8 + 1;
}

#[account]
pub struct ViewRight {
    pub owner: Pubkey,
    pub collection: Pubkey,
    pub expires_at: i64,
    pub bump: u8,
}

impl ViewRight {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 8 + 1;
}

#[account]
pub struct PinnerCollectionBond {
    pub pinner: Pubkey,
    pub collection: Pubkey,
    pub last_audit_pass: i64,
    pub bump: u8,
}

impl PinnerCollectionBond {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 8 + 1;
}

#[account]
pub struct ModTicket {
    pub reporter: Pubkey,
    pub target_id: String, // Video hash or Collection ID
    pub reason: String,
    pub resolved: bool,
    pub verdict: bool, // true = approved (banned), false = rejected
    pub bump: u8,
}

impl ModTicket {
    pub const MAX_SIZE: usize = 8 + 32 + (4+64) + (4+128) + 1 + 1 + 1;
}
