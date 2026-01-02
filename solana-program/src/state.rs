use anchor_lang::prelude::*;

pub const MAX_ID_LEN: usize = 32;
pub const MAX_URL_LEN: usize = 200;
pub const MAX_NAME_LEN: usize = 50;

#[account]
pub struct ProtocolState {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_basis_points: u16, // Protocol fee
}

#[account]
pub struct CollectionState {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub collection_id: String, // limited by MAX_ID_LEN
    pub name: String,
    pub content_cid: String,   // IPFS CID
    pub access_price: u64,     // In USD cents (e.g. 100 = $1.00)
    
    // Reward Logic
    pub reward_pool_balance: u64,
    pub total_shares: u64,           // Total active pinner shares
    pub acc_reward_per_share: u128,  // Accumulated rewards per share (Precision 1e12)
}

#[account]
pub struct PinnerState {
    pub collection: Pubkey,
    pub pinner: Pubkey,
    pub last_audit_pass: i64,
    pub is_active: bool,
    
    // Reward Logic
    pub shares: u64,        // This pinner's stake/shares
    pub reward_debt: u128,  // Reward debt for MasterChef algorithm
}