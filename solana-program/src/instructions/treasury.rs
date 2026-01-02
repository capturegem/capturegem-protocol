use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, HarvestWithheldTokensToMint, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

#[derive(Accounts)]
pub struct HarvestFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        mut,
        mint::token_program = token_program
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Destination for withheld fees from Token-2022
    #[account(mut)]
    pub fee_vault: UncheckedAccount<'info>,

    /// CHECK: Owner's token account to receive 20% of fees
    #[account(mut)]
    pub owner_token_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_PERFORMER_ESCROW, collection.key().as_ref()],
        bump
    )]
    pub performer_escrow: Account<'info, PerformerEscrow>,

    #[account(
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// CHECK: Treasury account for staker rewards (10%)
    #[account(mut)]
    pub staker_treasury: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn harvest_fees(ctx: Context<HarvestFees>) -> Result<()> {
    let collection = &mut ctx.accounts.collection;

    // 1. Harvest withheld tokens from accounts to the Mint (standard Token 2022 flow)
    // Note: In a real scenario, you pass a list of token accounts to harvest from. 
    // For now, we assume the harvested amount is calculated externally
    // In production: Use HarvestWithheldTokensToMint CPI
    
    // Mock: Assume we have the harvested amount
    // In production, this would come from the actual harvest operation
    let harvested_amount: u64 = 1000; // This should be the actual harvested amount

    // 2. Split fees according to 50/20/20/10 distribution
    let pinner_share = harvested_amount
        .checked_mul(SPLIT_PINNER)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let owner_share = harvested_amount
        .checked_mul(SPLIT_OWNER)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let performer_share = harvested_amount
        .checked_mul(SPLIT_PERFORMER)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let staker_share = harvested_amount
        .checked_mul(SPLIT_STAKERS)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    // Verify the split adds up correctly (accounting for rounding)
    let total_split = pinner_share
        .checked_add(owner_share)
        .and_then(|v| v.checked_add(performer_share))
        .and_then(|v| v.checked_add(staker_share))
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Handle any rounding remainder by adding to pinner share
    let remainder = harvested_amount.checked_sub(total_split).unwrap_or(0);
    let final_pinner_share = pinner_share.checked_add(remainder).unwrap_or(pinner_share);

    // 3. Update CollectionState reward balances
    // 50% to Pinners (distributed via MasterChef algorithm)
    if collection.total_shares > 0 {
        let precision = 1_000_000_000_000u128;
        let reward_added = (final_pinner_share as u128)
            .checked_mul(precision)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(collection.total_shares as u128)
            .ok_or(ProtocolError::MathOverflow)?;

        collection.acc_reward_per_share = collection.acc_reward_per_share
            .checked_add(reward_added)
            .ok_or(ProtocolError::MathOverflow)?;
    }
    collection.reward_pool_balance = collection.reward_pool_balance
        .checked_add(final_pinner_share)
        .ok_or(ProtocolError::MathOverflow)?;

    // 20% to Owner (accumulated, can be claimed separately)
    collection.owner_reward_balance = collection.owner_reward_balance
        .checked_add(owner_share)
        .ok_or(ProtocolError::MathOverflow)?;

    // 20% to Performer Escrow
    let performer_escrow = &mut ctx.accounts.performer_escrow;
    performer_escrow.balance = performer_escrow.balance
        .checked_add(performer_share)
        .ok_or(ProtocolError::MathOverflow)?;

    // 10% to Stakers (sent to global treasury)
    // In production: Transfer tokens to staker_treasury via CPI
    // For now, we just track it - actual distribution would be handled by a separate staking contract
    collection.staker_reward_balance = collection.staker_reward_balance
        .checked_add(staker_share)
        .ok_or(ProtocolError::MathOverflow)?;

    // 4. In production, perform actual token transfers via CPI
    // - Transfer owner_share to owner_token_account
    // - Transfer performer_share to performer_escrow token account
    // - Transfer staker_share to staker_treasury

    Ok(())
}