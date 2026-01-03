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
    pub fee_basis_points: u16,     // Purchase fee in basis points (default: 200 = 2%). Collected on purchases and sent to treasury. Configurable via update_global_state.
    pub updates_disabled: bool,    // If true, GlobalState can no longer be updated (one-way lock)
    pub bump: u8,
}

impl GlobalState {
    // 8 (discriminator) + 32 (admin) + 32 (treasury) + 200 (indexer_api_url) + 200 (node_registry_url) 
    // + 8 (moderator_stake_minimum) + 32 (capgm_mint) + 2 (fee_basis_points) + 1 (updates_disabled) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 200 + 200 + 8 + 32 + 2 + 1 + 1;
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
    pub collection_id: String, // Unique slug (e.g., "cooking-101")
    pub cid_hash: [u8; 32],  // SHA-256 hash of the collection IPFS CID (not the CID itself)
    pub mint: Pubkey,        // The Collection Token Mint address
    pub pool_address: Pubkey, // The specific Orca Whirlpool/Pool Address
    pub claim_vault: Pubkey,  // PDA holding the 10% reserve
    pub claim_deadline: i64,  // Timestamp (Now + 6 months)
    pub total_trust_score: u64, // Aggregate reliability of this collection's swarm
    pub is_blacklisted: bool,  // Moderator toggle for illegal content
    pub name: String,
    pub content_cid: String,   // IPFS CID - DEPRECATED: Use cid_hash for privacy
    pub access_threshold_usd: u64, // In USD cents (e.g. 1000 = $10.00)
    pub oracle_feed: Pubkey,   // Price feed for this specific Collection Token
    
    // Reward Logic
    pub owner_reward_balance: u64, // Accumulated 20% fees for Owner
    pub staker_reward_balance: u64,   // Accumulated 10% fees for CAPGM Stakers
    pub tokens_minted: bool,          // Whether collection tokens have been minted (one-time operation)
    pub bump: u8,
}

impl CollectionState {
    // 8 (discriminator) + 32 (owner) + MAX_ID_LEN (collection_id) + 32 (cid_hash) + 32 (mint) + 32 (pool_address) 
    // + 32 (claim_vault) + 8 (claim_deadline) + 8 (total_trust_score) + 1 (is_blacklisted) + MAX_NAME_LEN (name)
    // + MAX_URL_LEN (content_cid) + 8 (access_threshold_usd) + 32 (oracle_feed)
    // + 8 (owner_reward_balance) + 8 (staker_reward_balance)
    // + 1 (tokens_minted) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 32 + MAX_ID_LEN + 32 + 32 + 32 + 32 + 8 + 8 + 1 + MAX_NAME_LEN + MAX_URL_LEN + 8 + 32 + 8 + 8 + 1 + 1;
}

#[account]
pub struct ViewRights {
    pub owner: Pubkey,
    pub collection: Pubkey,
    pub minted_at: i64,    // Unix timestamp when minted/renewed
    pub expires_at: i64,   // Unix timestamp when access expires (minted_at + 90 days)
}

#[account]
pub struct AccessEscrow {
    pub purchaser: Pubkey,       // The user buying content (only they can release funds)
    pub collection: Pubkey,       // The content being bought
    pub access_nft_mint: Pubkey,  // The NFT mint address proving access rights
    pub cid_hash: [u8; 32],      // SHA-256 hash of the collection CID (for verification)
    pub amount_locked: u64,       // Tokens (50% of purchase), waiting for release to peers
    pub created_at: i64,          // Timestamp for 24-hour burn timeout logic
    pub is_cid_revealed: bool,    // Whether a pinner has revealed the CID
    pub bump: u8,
}

impl AccessEscrow {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1;
}

#[account]
pub struct CidReveal {
    pub escrow: Pubkey,              // The AccessEscrow this reveal is for
    pub pinner: Pubkey,              // The peer who revealed the CID (must be a registered pinner)
    pub encrypted_cid: Vec<u8>,      // CID encrypted with purchaser's public key (X25519-XSalsa20-Poly1305)
    pub revealed_at: i64,            // Timestamp of reveal
    pub bump: u8,
}

impl CidReveal {
    // 8 (discriminator) + 32 (escrow) + 32 (pinner) + 4 (vec length) + 200 (encrypted CID, typically ~100 bytes) + 8 (timestamp) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 4 + 200 + 8 + 1;
}

#[account]
pub struct PeerTrustState {
    pub peer_wallet: Pubkey,
    pub total_successful_serves: u64, // Total number of released escrows
    pub trust_score: u64,             // Weighted score (Serves * Consistency)
    pub last_active: i64,             // For pruning inactive nodes
}

impl PeerTrustState {
    pub const MAX_SIZE: usize = 8 + 32 + 8 + 8 + 8;
}

#[account]
pub struct PinnerState {
    pub collection: Pubkey,
    pub pinner: Pubkey,
    pub is_active: bool,
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
    pub created_at: i64,        // Unix timestamp when the ticket was created
    pub bump: u8,
}

impl ModTicket {
    // 8 (discriminator) + 32 (reporter) + MAX_ID_LEN (target_id) + 1 (ticket_type) + MAX_REASON_LEN (reason)
    // + 1 (resolved) + 1 (verdict) + 33 (resolver Option<Pubkey>) + 8 (created_at) + 1 (bump)
    pub const MAX_SIZE: usize = 8 + 32 + MAX_ID_LEN + 1 + MAX_REASON_LEN + 1 + 1 + 33 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TicketType {
    ContentReport,   // Flagging illegal or TOS-violating content
    CopyrightClaim, // IP disputes - transfers 10% Claim Vault tokens to claimant
    CidCensorship,   // Censoring specific CIDs - reimburses stakeholders from collection pools
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
pub struct CollectionStakingPool {
    pub collection: Pubkey,           // The collection this pool is for
    pub total_staked: u64,            // Total collection tokens staked in this pool
    pub reward_per_token: u128,       // Accumulated rewards per token (scaled by REWARD_PRECISION)
    pub bump: u8,
}

impl CollectionStakingPool {
    pub const MAX_SIZE: usize = 8 + 32 + 8 + 16 + 1;
}

#[account]
pub struct StakerPosition {
    pub staker: Pubkey,               // The user who staked
    pub collection: Pubkey,           // The collection being staked
    pub amount_staked: u64,           // Number of collection tokens staked
    pub reward_debt: u128,            // Used to calculate pending rewards (scaled by REWARD_PRECISION)
    pub bump: u8,
}

impl StakerPosition {
    pub const MAX_SIZE: usize = 8 + 32 + 32 + 8 + 16 + 1;
}
