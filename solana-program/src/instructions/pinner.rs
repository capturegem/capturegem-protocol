// solana-program/programs/solana-program/src/instructions/pinner.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::CaptureGemError;

#[derive(Accounts)]
pub struct RegisterHost<'info> {
    #[account(mut)]
    pub pinner: Signer<'info>,

    #[account(mut)]
    pub collection_state: Account<'info, CollectionState>,

    #[account(
        init,
        payer = pinner,
        space = PinnerCollectionBond::MAX_SIZE,
        seeds = [SEED_PINNER_BOND, pinner.key().as_ref(), collection_state.key().as_ref()],
        bump
    )]
    pub bond: Account<'info, PinnerCollectionBond>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub pinner: Signer<'info>,
    
    #[account(mut)]
    pub collection_state: Account<'info, CollectionState>,
    
    #[account(
        mut,
        seeds = [SEED_PINNER_BOND, pinner.key().as_ref(), collection_state.key().as_ref()],
        bump = bond.bump,
        has_one = pinner,
        has_one = collection = collection_state.key()
    )]
    pub bond: Account<'info, PinnerCollectionBond>,
}

pub fn register_collection_host(ctx: Context<RegisterHost>) -> Result<()> {
    let bond = &mut ctx.accounts.bond;
    bond.pinner = ctx.accounts.pinner.key();
    bond.collection = ctx.accounts.collection_state.key();
    bond.last_audit_pass = Clock::get()?.unix_timestamp;
    bond.bump = ctx.bumps.bond;
    Ok(())
}

pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let bond = &ctx.accounts.bond;
    let now = Clock::get()?.unix_timestamp;

    // Verify Audit Recency
    if bond.last_audit_pass < (now - PINNER_AUDIT_WINDOW) {
        return err!(CaptureGemError::PinnerClaimTooEarly); // Or "AuditExpired"
    }

    // Distribute Logic
    // In a full implementation, this calculates share based on pool weight.
    // For MVP/TDD, we assume a simple payout from the accumulated pool in CollectionState.
    
    let collection = &mut ctx.accounts.collection_state;
    let payout = collection.reward_pool_balance; // Simplified: Drains pool (Example only)
    
    if payout > 0 {
        collection.reward_pool_balance = 0;
        // Transfer logic (System Program transfer or SPL transfer) would go here
        // **ctx.accounts.pinner.try_borrow_mut_lamports()? += payout;**
    }

    Ok(())
}
