// solana-program/programs/solana-program/src/instructions/treasury.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::CaptureGemError;

#[derive(Accounts)]
pub struct HarvestFees<'info> {
    #[account(mut)]
    pub payer: Signer<'info>, // Can be anyone (crank)
    
    #[account(mut)]
    pub collection_state: Account<'info, CollectionState>,

    // In a real implementation using Token-2022 Transfer Fees, 
    // you would need accounts for the Mint and the Authority to withdraw withheld tokens.
}

pub fn harvest_fees(ctx: Context<HarvestFees>, harvested_amount: u64) -> Result<()> {
    // Logic:
    // 1. Withdraw 'harvested_amount' from Token-2022 withheld account.
    // 2. Split logic defined in Constants.
    
    let collection = &mut ctx.accounts.collection_state;
    
    let pinner_share = harvested_amount.checked_mul(SPLIT_PINNER).unwrap().checked_div(100).unwrap();
    let owner_share = harvested_amount.checked_mul(SPLIT_OWNER).unwrap().checked_div(100).unwrap();
    let performer_share = harvested_amount.checked_mul(SPLIT_PERFORMER).unwrap().checked_div(100).unwrap();
    // Stakers share = remainder
    
    // Update internal accounting for Pinner Pool
    collection.reward_pool_balance = collection.reward_pool_balance.checked_add(pinner_share).unwrap();

    // Actual SPL transfers to Owner/Performer vaults would happen here.

    Ok(())
}
