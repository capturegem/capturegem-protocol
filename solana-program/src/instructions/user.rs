// solana-program/programs/solana-program/src/instructions/user.rs
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022}; 
// Note: Requires anchor-spl with "token_2022" feature enabled in Cargo.toml

use crate::state::*;
use crate::constants::*;
use crate::errors::CaptureGemError;

#[derive(Accounts)]
pub struct InitUser<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = UserAccount::MAX_SIZE,
        seeds = [SEED_USER_ACCOUNT, authority.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(collection_id: String)]
pub struct CreateCollection<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        init,
        payer = owner,
        space = CollectionState::MAX_SIZE,
        seeds = [SEED_COLLECTION_STATE, owner.key().as_ref(), collection_id.as_bytes()],
        bump
    )]
    pub collection_state: Account<'info, CollectionState>,

    /// CHECK: This is a simplified check. In production, use InitToken instruction via CPI
    /// or verify Mint creation matches Token-2022 standards with TransferFeeConfig extensions.
    #[account(mut)]
    pub collection_mint: Signer<'info>, 

    pub token_program: Interface<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_user(ctx: Context<InitUser>, ipns_key: String) -> Result<()> {
    let user = &mut ctx.accounts.user_account;
    user.authority = ctx.accounts.authority.key();
    user.ipns_key = ipns_key;
    user.is_online = true;
    user.bump = ctx.bumps.user_account;
    Ok(())
}

pub fn create_collection(
    ctx: Context<CreateCollection>, 
    collection_id: String, 
    max_videos: u32,
    oracle_feed: Pubkey,
    access_threshold: u64
) -> Result<()> {
    // Note: Actual Mint initialization logic omitted for brevity. 
    // In a real TDD implementation, this would invoke token_2022::initialize_mint 
    // and token_2022::initialize_transfer_fee_config.

    let col = &mut ctx.accounts.collection_state;
    col.owner = ctx.accounts.owner.key();
    col.collection_id = collection_id;
    col.collection_token_mint = ctx.accounts.collection_mint.key();
    col.oracle_feed = oracle_feed;
    col.access_threshold_usd = access_threshold;
    col.max_video_limit = max_videos;
    col.video_count = 0;
    col.reward_pool_balance = 0;
    col.bump = ctx.bumps.collection_state;

    Ok(())
}
