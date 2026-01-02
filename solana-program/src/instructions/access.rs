// solana-program/programs/solana-program/src/instructions/access.rs
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, Mint, Token2022};
use crate::state::*;
use crate::constants::*;
use crate::errors::CaptureGemError;

#[derive(Accounts)]
pub struct MintViewRight<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [SEED_COLLECTION_STATE, collection_state.owner.as_ref(), collection_state.collection_id.as_bytes()],
        bump = collection_state.bump
    )]
    pub collection_state: Account<'info, CollectionState>,

    #[account(
        mut,
        associated_token::mint = collection_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = collection_state.collection_token_mint)]
    pub collection_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        space = ViewRight::MAX_SIZE,
        seeds = [SEED_VIEW_RIGHT, collection_mint.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub view_right: Account<'info, ViewRight>,

    /// CHECK: Trusted Oracle feed, verified against collection_state
    #[account(address = collection_state.oracle_feed)]
    pub oracle_feed: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, Token2022>,
}

pub fn mint_view_right(ctx: Context<MintViewRight>) -> Result<()> {
    let collection = &ctx.accounts.collection_state;
    let user_balance = ctx.accounts.user_token_account.amount;

    // 1. Fetch Price from Oracle (Mock logic)
    // In production, deserialize Pyth/Switchboard data here.
    // Example: let price = get_price(&ctx.accounts.oracle_feed)?;
    let token_price_usd = 1_00; // Mock: $1.00 (2 decimals)
    
    // 2. Calculate Value
    // Value = Balance * Price
    let user_value_usd = user_balance.checked_mul(token_price_usd).ok_or(CaptureGemError::Overflow)?;

    // 3. Check Threshold
    if user_value_usd < collection.access_threshold_usd {
        return err!(CaptureGemError::InsufficientFunds);
    }

    // 4. Update/Create View Right PDA
    let view_right = &mut ctx.accounts.view_right;
    let now = Clock::get()?.unix_timestamp;

    // If currently valid, extend? Or just error? Design says renewable.
    if view_right.expires_at > now {
        // Option A: Extend
        view_right.expires_at = view_right.expires_at + VIEW_RIGHTS_VALIDITY_SECONDS;
    } else {
        // Option B: New
        view_right.expires_at = now + VIEW_RIGHTS_VALIDITY_SECONDS;
    }
    
    view_right.owner = ctx.accounts.user.key();
    view_right.collection = collection.key();
    view_right.bump = ctx.bumps.view_right;

    Ok(())
}
