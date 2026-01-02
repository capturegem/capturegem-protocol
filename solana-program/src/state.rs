use anchor_lang::prelude::*;

pub const MAX_ID_LEN: usize = 32;
pub const MAX_URL_LEN: usize = 200;
pub const MAX_NAME_LEN: usize = 50;
pub const MAX_IPNS_KEY_LEN: usize = 100;
pub const MAX_REASON_LEN: usize = 200;

#[account]
pub struct GlobalState {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub indexer_api_url: String,   // URL for the indexer API
    pub node_registry_url: String, // URL for the node registry
    pub moderator_stake_minimum: u64, // Minimum CAPGM stake required to be a moderator
    pub capgm_mint: Pubkey,        // The CAPGM ecosystem token mint
    pub fee_basis_points: u16,     // Protocol fee
    pub bump: u8,
}

impl GlobalState {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 200 + 200 + 8 + 32 + 2 + 1;
}

#[account]
pub struct UserAccount {
    pub authority: Pubkey,
    pub ipns_key: String,   // IPNS key pointing to off-chain metadata (Avatar, Bio)
    pub is_online: bool,
    pub bump: u8,
}

impl UserAccount {
    pub const MAX_SIZE: usize = 8 + 32 + MAX_IPNS_KEY_LEN + 1 + 1;
}

#[account]
pub struct CollectionState {
    pub owner: Pubkey,      // Collection owner (matches design)
    pub mint: Pubkey,
    pub collection_id: String, // limited by MAX_ID_LEN
    pub name: String,
    pub content_cid: String,   // IPFS CID
    pub access_threshold_usd: u64, // In USD cents (e.g. 1000 = $10.00)
    pub oracle_feed: Pubkey,   // Price feed for this specific Collection Token
    
    // Video Management
    pub max_video_limit: u32,  // Maximum number of videos allowed
    pub video_count: u32,      // Current number of videos
    
    // Reward Logic
    pub reward_pool_balance: u64,  // Accumulated 50% fees for Pinners
    pub owner_reward_balance: u64, // Accumulated 20% fees for Owner
    pub performer_escrow_balance: u64, // Accumulated 20% fees for Performer
    pub staker_reward_balance: u64,   // Accumulated 10% fees for CAPGM Stakers
    pub total_shares: u64,           // Total active pinner shares
    pub acc_reward_per_share: u128,  // Accumulated rewards per share (Precision 1e12)
}

#[account]
pub struct ViewRights {
    pub owner: Pubkey,
    pub collection: Pubkey,
    pub minted_at: i64,    // Unix timestamp when minted/renewed
    pub expires_at: i64,   // Unix timestamp when access expires (minted_at + 90 days)
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

#[account]
pub struct PerformerEscrow {
    pub collection: Pubkey,
    pub performer_wallet: Pubkey,  // Wallet address of the performer (can be updated via moderation)
    pub balance: u64,              // Accumulated performer fees
    pub bump: u8,
}

impl PerformerEscrow {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 8 + 1;
}

#[account]
pub struct ModTicket {
    pub reporter: Pubkey,
    pub target_id: String,      // ID of the content being reported
    pub ticket_type: TicketType,
    pub reason: String,
    pub resolved: bool,
    pub verdict: bool,          // true = approved (banned), false = rejected (kept)
    pub resolver: Option<Pubkey>, // Moderator who resolved it
    pub bump: u8,
}

impl ModTicket {
    pub const MAX_SIZE: usize = 8 + 32 + MAX_ID_LEN + 1 + MAX_REASON_LEN + 1 + 1 + 33 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TicketType {
    ContentReport,   // Flagging illegal or TOS-violating content
    DuplicateReport, // Flagging re-uploaded or copy-cat content
    PerformerClaim,  // Performer claiming their fee share
}

#[account]
pub struct ModeratorStake {
    pub moderator: Pubkey,
    pub stake_amount: u64,      // Amount of CAPGM staked
    pub is_active: bool,
    pub slash_count: u32,      // Number of times slashed
    pub bump: u8,
}

impl ModeratorStake {
    pub const MAX_SIZE: usize = 8 + 32 + 8 + 1 + 4 + 1;
}

#[account]
pub struct VideoState {
    pub collection: Pubkey,
    pub video_id: String,       // Content hash or unique ID
    pub root_cid: String,       // IPFS CID of the HLS directory
    pub performer_wallet: Option<Pubkey>, // Performer's wallet (for fee distribution)
    pub uploaded_at: i64,
    pub bump: u8,
}

impl VideoState {
    pub const MAX_SIZE: usize = 8 + 32 + MAX_ID_LEN + MAX_URL_LEN + 33 + 8 + 1;
}