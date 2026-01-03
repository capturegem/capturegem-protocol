use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::TicketType;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

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

    pub fn buy_access_token(ctx: Context<BuyAccess>) -> Result<()> {
        instructions::access::buy_access_token(ctx)
    }

    pub fn register_collection_host(ctx: Context<RegisterHost>) -> Result<()> {
        instructions::pinner::register_collection_host(ctx)
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::pinner::claim_rewards(ctx)
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
}