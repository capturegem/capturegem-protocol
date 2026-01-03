use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TokenAccount, Transfer};
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
        bump = collection.bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        mut,
        seeds = [b"host_bond", pinner.key().as_ref(), collection.key().as_ref()],
        bump,
        constraint = pinner_state.pinner == pinner.key() @ ProtocolError::Unauthorized
    )]
    pub pinner_state: Account<'info, PinnerState>,

    /// Fee vault token account (owned by collection PDA) containing pinner rewards
    /// This is the token account where harvested fees (50% pinner share) are stored
    #[account(
        mut,
        constraint = fee_vault.owner == collection.key() @ ProtocolError::Unauthorized,
        constraint = fee_vault.mint == collection.mint @ ProtocolError::InvalidAccount
    )]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,

    /// Pinner's token account to receive rewards (ATA for collection token mint)
    #[account(
        mut,
        constraint = pinner_token_account.owner == pinner.key() @ ProtocolError::Unauthorized,
        constraint = pinner_token_account.mint == collection.mint @ ProtocolError::InvalidAccount
    )]
    pub pinner_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
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
    // Get values before mutable borrows
    let pinner_state_shares = ctx.accounts.pinner_state.shares;
    let pinner_state_reward_debt = ctx.accounts.pinner_state.reward_debt;
    let pinner_state_is_active = ctx.accounts.pinner_state.is_active;
    let collection_acc_reward_per_share = ctx.accounts.collection.acc_reward_per_share;
    let collection_owner = ctx.accounts.collection.owner;
    let collection_id = ctx.accounts.collection.collection_id.clone();
    let collection_bump = ctx.accounts.collection.bump;
    let fee_vault_amount = ctx.accounts.fee_vault.amount;

    // 1. Verify pinner is active
    require!(pinner_state_is_active, ProtocolError::Unauthorized);

    // 2. Calculate accumulated reward
    // pending = (shares * acc_reward_per_share) - reward_debt
    let accumulated = (pinner_state_shares as u128)
        .checked_mul(collection_acc_reward_per_share)
        .ok_or(ProtocolError::MathOverflow)?;

    let pending = accumulated
        .saturating_sub(pinner_state_reward_debt);

    require!(pending > 0, ProtocolError::InsufficientFunds);
    
    // 3. Convert pending reward from precision-scaled value to actual tokens
    // pending is in precision units (1e12), divide by precision to get actual token amount
    let pending_tokens = (pending / crate::constants::REWARD_PRECISION) as u64;
    require!(pending_tokens > 0, ProtocolError::InsufficientFunds);
    
    // 4. Verify fee_vault has sufficient balance
    require!(
        fee_vault_amount >= pending_tokens,
        ProtocolError::InsufficientFunds
    );

    // 5. Update state BEFORE transfer to prevent reentrancy
    let collection = &mut ctx.accounts.collection;
    let pinner_state = &mut ctx.accounts.pinner_state;
    
    collection.reward_pool_balance = collection.reward_pool_balance
        .checked_sub(pending_tokens)
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Reset debt
    pinner_state.reward_debt = accumulated;

    // 6. Transfer SPL tokens from fee_vault to pinner's token account
    // Collection PDA signs the transfer as the authority of fee_vault
    let collection_seeds = &[
        b"collection",
        collection_owner.as_ref(),
        collection_id.as_bytes(),
        &[collection_bump],
    ];
    let signer_seeds = &[&collection_seeds[..]];

    let transfer_ix = Transfer {
        from: ctx.accounts.fee_vault.to_account_info(),
        to: ctx.accounts.pinner_token_account.to_account_info(),
        authority: ctx.accounts.collection.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_ix,
        signer_seeds,
    );
    
    anchor_spl::token_interface::transfer(cpi_ctx, pending_tokens)?;

    msg!(
        "PinnerRewardsClaimed: Pinner={} Collection={} Amount={}",
        ctx.accounts.pinner.key(),
        collection_id,
        pending_tokens
    );

    Ok(())
}