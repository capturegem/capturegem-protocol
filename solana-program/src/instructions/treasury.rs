use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, HarvestWithheldTokensToMint, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::state::*;
use crate::errors::ProtocolError;

#[derive(Accounts)]
pub struct HarvestFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        mut,
        mint::token_program = token_program
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Destination for withheld fees. 
    #[account(mut)]
    pub vault: UncheckedAccount<'info>, 

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn harvest_fees(ctx: Context<HarvestFees>) -> Result<()> {
    let collection = &mut ctx.accounts.collection;

    // 1. Harvest withheld tokens from accounts to the Mint (standard Token 2022 flow)
    // Note: In a real scenario, you pass a list of token accounts to harvest from. 
    // Simplification: We assume we are harvesting from the mint's own buffer or specific accounts.
    
    // ... CPI logic to harvest ...

    // 2. Simulate "Sell fees for SOL" or "Add to reward pool"
    // For this prototype, we assume we calculated the harvested amount
    let harvested_amount: u64 = 1000; // Mock amount

    if collection.total_shares > 0 {
        // Distribute to shareholders
        // acc_reward_per_share += amount / total_shares
        // We use a precision multiplier (1e12) to handle small amounts
        let precision = 1_000_000_000_000;
        
        let reward_added = (harvested_amount as u128)
            .checked_mul(precision)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(collection.total_shares as u128)
            .ok_or(ProtocolError::MathOverflow)?;

        collection.acc_reward_per_share = collection.acc_reward_per_share
            .checked_add(reward_added)
            .ok_or(ProtocolError::MathOverflow)?;
            
        collection.reward_pool_balance += harvested_amount;
    }

    Ok(())
}