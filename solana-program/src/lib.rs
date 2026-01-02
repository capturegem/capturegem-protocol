// solana-program/programs/solana-program/src/lib.rs
use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod state;
pub mod instructions;

use instructions::*;

declare_id!("3zPs2F67GNWofnpbKSDwy3CmHap8KTVWBPLLXABzQmRv");

#[program]
pub mod solana_program {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeGlobal>, 
        indexer_url: String, 
        registry_url: String, 
        mod_stake_min: u64
    ) -> Result<()> {
        instructions::admin::initialize_protocol(ctx, indexer_url, registry_url, mod_stake_min)
    }

    pub fn initialize_user(ctx: Context<InitUser>, ipns_key: String) -> Result<()> {
        instructions::user::initialize_user(ctx, ipns_key)
    }

    pub fn create_collection(
        ctx: Context<CreateCollection>, 
        collection_id: String, 
        max_videos: u32,
        oracle_feed: Pubkey,
        access_threshold: u64
    ) -> Result<()> {
        instructions::user::create_collection(ctx, collection_id, max_videos, oracle_feed, access_threshold)
    }

    pub fn mint_view_right(ctx: Context<MintViewRight>) -> Result<()> {
        instructions::access::mint_view_right(ctx)
    }

    pub fn register_host(ctx: Context<RegisterHost>) -> Result<()> {
        instructions::pinner::register_collection_host(ctx)
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::pinner::claim_rewards(ctx)
    }

    pub fn create_mod_ticket(ctx: Context<CreateTicket>, target_id: String, reason: String) -> Result<()> {
        instructions::moderation::create_ticket(ctx, target_id, reason)
    }

    pub fn resolve_mod_ticket(ctx: Context<ResolveTicket>, verdict: bool) -> Result<()> {
        instructions::moderation::resolve_ticket(ctx, verdict)
    }
}
