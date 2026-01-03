use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ProtocolError;

#[derive(Accounts)]
pub struct RegisterHost<'info> {
    #[account(mut)]
    pub pinner: Signer<'info>,
    
    #[account(
        mut, 
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        init,
        payer = pinner,
        space = 8 + 32 + 32 + 1 + 8 + 16, // Adjusted space: removed last_audit_pass (i64)
        seeds = [b"host_bond", pinner.key().as_ref(), collection.key().as_ref()],
        bump
    )]
    pub pinner_state: Account<'info, PinnerState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub pinner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        mut,
        seeds = [b"host_bond", pinner.key().as_ref(), collection.key().as_ref()],
        bump,
        constraint = pinner_state.pinner == pinner.key() @ ProtocolError::Unauthorized
    )]
    pub pinner_state: Account<'info, PinnerState>,
}

pub fn register_collection_host(ctx: Context<RegisterHost>) -> Result<()> {
    let pinner_state = &mut ctx.accounts.pinner_state;
    let collection = &mut ctx.accounts.collection;

    pinner_state.collection = collection.key();
    pinner_state.pinner = ctx.accounts.pinner.key();
    pinner_state.is_active = true;

    // Set Shares (1 share per pinner for now, could be based on storage size)
    pinner_state.shares = 1;
    
    // Update Collection total shares
    collection.total_shares = collection.total_shares.checked_add(pinner_state.shares).ok_or(ProtocolError::MathOverflow)?;

    // Calculate initial reward debt so they don't claim past rewards
    // debt = shares * acc_reward_per_share
    pinner_state.reward_debt = (pinner_state.shares as u128)
        .checked_mul(collection.acc_reward_per_share)
        .ok_or(ProtocolError::MathOverflow)?;

    Ok(())
}

pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let collection = &mut ctx.accounts.collection;
    let pinner_state = &mut ctx.accounts.pinner_state;

    // 1. Verify pinner is active
    require!(pinner_state.is_active, ProtocolError::Unauthorized);

    // 2. Calculate accumulated reward
    // pending = (shares * acc_reward_per_share) - reward_debt
    let accumulated = (pinner_state.shares as u128)
        .checked_mul(collection.acc_reward_per_share)
        .ok_or(ProtocolError::MathOverflow)?;

    let pending = accumulated
        .saturating_sub(pinner_state.reward_debt);

    require!(pending > 0, ProtocolError::InsufficientFunds);
    
    // 3. Ensure collection has funds
    let pending_u64 = pending as u64;
    require!(collection.reward_pool_balance >= pending_u64, ProtocolError::InsufficientFunds);

    // 4. Update State
    collection.reward_pool_balance = collection.reward_pool_balance.checked_sub(pending_u64).unwrap();
    
    // Reset debt
    pinner_state.reward_debt = accumulated;

    // 5. Transfer (Mock transfer from vault PDA to user)
    // In production: perform a CPI to transfer SOL or USDC from a vault PDA
    let pinner = &ctx.accounts.pinner;
    **pinner.to_account_info().try_borrow_mut_lamports()? += pending_u64;
    
    // Note: We need to subtract lamports from the PDA. 
    // This requires the PDA to actually hold the SOL being claimed.
    // For now, assuming the collection account holds the SOL reward pool.
    **collection.to_account_info().try_borrow_mut_lamports()? -= pending_u64;

    Ok(())
}