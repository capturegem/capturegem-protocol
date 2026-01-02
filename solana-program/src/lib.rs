use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod solana_program {
    use super::*;

    pub fn create_collection(
        ctx: Context<CreateCollection>, 
        collection_id: String, 
        name: String, 
        content_cid: String, 
        access_price: u64
    ) -> Result<()> {
        instructions::user::create_collection(ctx, collection_id, name, content_cid, access_price)
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
        mod_stake_min: u64
    ) -> Result<()> {
        instructions::admin::initialize_protocol(ctx, indexer_url, registry_url, mod_stake_min)
    }

    pub fn create_ticket(
        ctx: Context<CreateTicket>,
        target_id: String,
        reason: String
    ) -> Result<()> {
        instructions::moderation::create_ticket(ctx, target_id, reason)
    }

    pub fn resolve_ticket(
        ctx: Context<ResolveTicket>,
        verdict: bool
    ) -> Result<()> {
        instructions::moderation::resolve_ticket(ctx, verdict)
    }
}