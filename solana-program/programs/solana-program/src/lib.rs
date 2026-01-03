use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::TicketType;

declare_id!("jk9Hqt4dLcLcQzeDvVQ1actvY5EZu6cvT3SUc7JLM4m");

#[program]
pub mod solana_program {
    use super::*;

    pub fn initialize_user_account(
        ctx: Context<InitializeUserAccount>,
        ipns_key: String,
    ) -> Result<()> {
        instructions::user::initialize_user_account(ctx, ipns_key)
    }

    pub fn create_collection(
        ctx: Context<CreateCollection>, 
        collection_id: String, 
        name: String, 
        cid_hash: [u8; 32],
        access_threshold_usd: u64
    ) -> Result<()> {
        instructions::user::create_collection(ctx, collection_id, name, cid_hash, access_threshold_usd)
    }

    pub fn mint_collection_tokens(
        ctx: Context<MintCollectionTokens>,
        amount: u64,
    ) -> Result<()> {
        instructions::user::mint_collection_tokens(ctx, amount)
    }

    pub fn burn_unclaimed_tokens(ctx: Context<BurnUnclaimedTokens>) -> Result<()> {
        instructions::user::burn_unclaimed_tokens(ctx)
    }

    pub fn create_access_escrow(
        ctx: Context<CreateAccessEscrow>,
        amount_locked: u64,
        cid_hash: [u8; 32],
        access_nft_mint: Pubkey,
    ) -> Result<()> {
        instructions::access::create_access_escrow(ctx, amount_locked, cid_hash, access_nft_mint)
    }

    pub fn purchase_access(
        ctx: Context<PurchaseAccess>,
        total_amount: u64,
        cid_hash: [u8; 32],
    ) -> Result<()> {
        instructions::access::purchase_access(ctx, total_amount, cid_hash)
    }

    pub fn release_escrow<'info>(
        ctx: Context<'_, '_, '_, 'info, ReleaseEscrow<'info>>,
        peer_wallets: Vec<Pubkey>,
        peer_weights: Vec<u64>,
    ) -> Result<()> {
        instructions::access::release_escrow(ctx, peer_wallets, peer_weights)
    }

    pub fn burn_expired_escrow(ctx: Context<BurnExpiredEscrow>) -> Result<()> {
        instructions::access::burn_expired_escrow(ctx)
    }

    pub fn reveal_cid(
        ctx: Context<RevealCid>,
        encrypted_cid: Vec<u8>,
    ) -> Result<()> {
        instructions::access::reveal_cid(ctx, encrypted_cid)
    }

    pub fn register_collection_host(ctx: Context<RegisterHost>) -> Result<()> {
        instructions::pinner::register_collection_host(ctx)
    }

    pub fn initialize_protocol(
        ctx: Context<InitializeGlobal>,
        indexer_url: String,
        registry_url: String,
        mod_stake_min: u64,
        fee_basis_points: u16
    ) -> Result<()> {
        instructions::admin::initialize_protocol(ctx, indexer_url, registry_url, mod_stake_min, fee_basis_points)
    }

    pub fn stake_moderator(
        ctx: Context<StakeModerator>,
        stake_amount: u64,
    ) -> Result<()> {
        instructions::staking::stake_moderator(ctx, stake_amount)
    }

    pub fn slash_moderator(
        ctx: Context<SlashModerator>,
    ) -> Result<()> {
        instructions::staking::slash_moderator(ctx)
    }

    pub fn stake_collection_tokens(
        ctx: Context<StakeCollectionTokens>,
        amount: u64,
    ) -> Result<()> {
        instructions::staking::stake_collection_tokens(ctx, amount)
    }

    pub fn claim_staking_rewards(ctx: Context<ClaimStakingRewards>) -> Result<()> {
        instructions::staking::claim_staking_rewards(ctx)
    }

    pub fn unstake_collection_tokens(
        ctx: Context<UnstakeCollectionTokens>,
        amount: u64,
    ) -> Result<()> {
        instructions::staking::unstake_collection_tokens(ctx, amount)
    }

    pub fn initialize_performer_escrow(
        ctx: Context<InitializePerformerEscrow>,
        performer_wallet: Pubkey,
    ) -> Result<()> {
        instructions::performer::initialize_performer_escrow(ctx, performer_wallet)
    }

    pub fn claim_performer_escrow(
        ctx: Context<ClaimPerformerEscrow>,
    ) -> Result<()> {
        instructions::performer::claim_performer_escrow(ctx)
    }

    pub fn create_ticket(
        ctx: Context<CreateTicket>,
        target_id: String,
        ticket_type: TicketType,
        reason: String
    ) -> Result<()> {
        instructions::moderation::create_ticket(ctx, target_id, ticket_type, reason)
    }

    pub fn resolve_ticket(
        ctx: Context<ResolveTicket>,
        verdict: bool
    ) -> Result<()> {
        instructions::moderation::resolve_ticket(ctx, verdict)
    }

    pub fn resolve_copyright_claim(
        ctx: Context<ResolveCopyrightClaim>,
        verdict: bool,
        vault_amount: u64
    ) -> Result<()> {
        instructions::moderation::resolve_copyright_claim(ctx, verdict, vault_amount)
    }

    pub fn resolve_cid_censorship(
        ctx: Context<ResolveCidCensorship>,
        verdict: bool,
        censored_cid: String
    ) -> Result<()> {
        instructions::moderation::resolve_cid_censorship(ctx, verdict, censored_cid)
    }

    pub fn initialize_orca_pool(
        ctx: Context<InitializeOrcaPool>,
        tick_spacing: u16,
        initial_sqrt_price: u128,
    ) -> Result<()> {
        instructions::orca::initialize_orca_pool(ctx, tick_spacing, initial_sqrt_price)
    }

    pub fn open_orca_position(
        ctx: Context<OpenOrcaPosition>,
        tick_lower_index: i32,
        tick_upper_index: i32,
    ) -> Result<()> {
        instructions::orca::open_orca_position(ctx, tick_lower_index, tick_upper_index)
    }

    pub fn deposit_liquidity_to_orca(
        ctx: Context<DepositLiquidityToOrca>,
        liquidity_amount: u128,
        token_max_a: u64,
        token_max_b: u64,
    ) -> Result<()> {
        instructions::orca::deposit_liquidity_to_orca(ctx, liquidity_amount, token_max_a, token_max_b)
    }
}
