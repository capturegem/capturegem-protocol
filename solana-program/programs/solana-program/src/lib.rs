use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::TicketType;

declare_id!("Hwwr37aHr1EddJZmFEXcEnJr94XKrjRotN6mua2tsfaZ");

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
        content_cid: String, 
        access_threshold_usd: u64
    ) -> Result<()> {
        instructions::user::create_collection(ctx, collection_id, name, content_cid, access_threshold_usd)
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
    ) -> Result<()> {
        instructions::access::create_access_escrow(ctx, amount_locked)
    }

    pub fn release_escrow(
        ctx: Context<ReleaseEscrow>,
        peer_wallets: Vec<Pubkey>,
        peer_weights: Vec<u64>,
    ) -> Result<()> {
        instructions::access::release_escrow(ctx, peer_wallets, peer_weights)
    }

    pub fn register_collection_host(ctx: Context<RegisterHost>) -> Result<()> {
        instructions::pinner::register_collection_host(ctx)
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::pinner::claim_rewards(ctx)
    }
    
    pub fn submit_audit_result(ctx: Context<SubmitAudit>, success: bool) -> Result<()> {
        instructions::pinner::submit_audit_result(ctx, success)
    }

    pub fn harvest_fees(ctx: Context<HarvestFees>) -> Result<()> {
        instructions::treasury::harvest_fees(ctx)
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
}
