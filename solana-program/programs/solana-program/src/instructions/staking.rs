// solana-program/programs/solana-program/src/instructions/staking.rs
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TransferChecked, Mint};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

// ============================================================================
// Moderator Staking (CAPGM Token)
// ============================================================================

#[derive(Accounts)]
pub struct StakeModerator<'info> {
    #[account(mut)]
    pub moderator: Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// CHECK: Moderator's CAPGM token account
    #[account(mut)]
    pub moderator_token_account: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = moderator,
        space = ModeratorStake::MAX_SIZE,
        seeds = [b"moderator_stake", moderator.key().as_ref()],
        bump
    )]
    pub moderator_stake: Account<'info, ModeratorStake>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn stake_moderator(
    ctx: Context<StakeModerator>,
    stake_amount: u64,
) -> Result<()> {
    let global_state = &ctx.accounts.global_state;
    let moderator_stake = &mut ctx.accounts.moderator_stake;
    let _moderator_token_account = &ctx.accounts.moderator_token_account;

    // Check if stake amount meets minimum requirement
    require!(
        stake_amount >= global_state.moderator_stake_minimum,
        ProtocolError::InsufficientModeratorStake
    );

    // Update or initialize moderator stake
    moderator_stake.moderator = ctx.accounts.moderator.key();
    moderator_stake.stake_amount = moderator_stake.stake_amount
        .checked_add(stake_amount)
        .ok_or(ProtocolError::MathOverflow)?;
    moderator_stake.is_active = true;
    moderator_stake.bump = ctx.bumps.moderator_stake;

    // In production: Transfer CAPGM tokens to a staking vault via CPI

    Ok(())
}

#[derive(Accounts)]
pub struct SlashModerator<'info> {
    pub super_moderator: Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump,
        constraint = global_state.admin == super_moderator.key() @ ProtocolError::Unauthorized
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [b"moderator_stake", moderator.key().as_ref()],
        bump
    )]
    pub moderator_stake: Account<'info, ModeratorStake>,

    /// CHECK: Moderator being slashed
    pub moderator: UncheckedAccount<'info>,
}

pub fn slash_moderator(ctx: Context<SlashModerator>) -> Result<()> {
    let moderator_stake = &mut ctx.accounts.moderator_stake;

    // Slash the stake (set to 0 and deactivate)
    moderator_stake.stake_amount = 0;
    moderator_stake.is_active = false;
    moderator_stake.slash_count = moderator_stake.slash_count
        .checked_add(1)
        .ok_or(ProtocolError::MathOverflow)?;

    // In production: Burn or transfer slashed tokens to treasury via CPI

    msg!("ModeratorSlashed: Moderator={}", ctx.accounts.moderator.key());

    Ok(())
}

// ============================================================================
// Collection Token Staking (for earning rewards from access purchases)
// ============================================================================

#[derive(Accounts)]
pub struct StakeCollectionTokens<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        init_if_needed,
        payer = staker,
        space = CollectionStakingPool::MAX_SIZE,
        seeds = [SEED_STAKING_POOL, collection.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, CollectionStakingPool>,

    #[account(
        init_if_needed,
        payer = staker,
        space = StakerPosition::MAX_SIZE,
        seeds = [SEED_STAKER_POSITION, staker.key().as_ref(), collection.key().as_ref()],
        bump
    )]
    pub staker_position: Account<'info, StakerPosition>,

    /// CHECK: Staker's collection token account
    #[account(mut)]
    pub staker_token_account: UncheckedAccount<'info>,

    /// CHECK: Staking pool's collection token account
    #[account(mut)]
    pub pool_token_account: UncheckedAccount<'info>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Stake collection tokens to earn rewards from access purchases
pub fn stake_collection_tokens(
    ctx: Context<StakeCollectionTokens>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ProtocolError::InsufficientFunds);

    let staking_pool = &mut ctx.accounts.staking_pool;
    let staker_position = &mut ctx.accounts.staker_position;
    let collection = &ctx.accounts.collection;

    // Initialize pool if needed
    if staking_pool.collection == Pubkey::default() {
        staking_pool.collection = collection.key();
        staking_pool.total_staked = 0;
        staking_pool.reward_per_token = 0;
        staking_pool.bump = ctx.bumps.staking_pool;
    }

    // Initialize position if needed
    if staker_position.staker == Pubkey::default() {
        staker_position.staker = ctx.accounts.staker.key();
        staker_position.collection = collection.key();
        staker_position.amount_staked = 0;
        staker_position.reward_debt = 0;
        staker_position.bump = ctx.bumps.staker_position;
    }

    // Claim any pending rewards before updating stake
    if staker_position.amount_staked > 0 {
        let pending = (staker_position.amount_staked as u128)
            .checked_mul(staking_pool.reward_per_token)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_sub(staker_position.reward_debt)
            .ok_or(ProtocolError::MathOverflow)?;
        
        if pending > 0 {
            let pending_tokens = (pending / REWARD_PRECISION) as u64;
            if pending_tokens > 0 {
                // Transfer pending rewards from pool to staker
                // In production: Implement actual token transfer via CPI
                msg!("AutoClaim: Staker={} Amount={}", ctx.accounts.staker.key(), pending_tokens);
            }
        }
    }

    // Transfer tokens from staker to pool (no fees on staking)
    let transfer_ix = TransferChecked {
        from: ctx.accounts.staker_token_account.to_account_info(),
        mint: ctx.accounts.collection_mint.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.staker.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_ix);
    anchor_spl::token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.collection_mint.decimals)?;

    // Update staking pool with full amount (no fees deducted)
    staking_pool.total_staked = staking_pool.total_staked
        .checked_add(amount)
        .ok_or(ProtocolError::MathOverflow)?;

    // Update staker position with full amount (no fees deducted)
    staker_position.amount_staked = staker_position.amount_staked
        .checked_add(amount)
        .ok_or(ProtocolError::MathOverflow)?;
    
    staker_position.reward_debt = (staker_position.amount_staked as u128)
        .checked_mul(staking_pool.reward_per_token)
        .ok_or(ProtocolError::MathOverflow)?;

    msg!(
        "CollectionTokensStaked: Staker={} Collection={} Amount={} TotalStaked={}",
        ctx.accounts.staker.key(),
        collection.collection_id,
        amount,
        staking_pool.total_staked
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimStakingRewards<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        mut,
        seeds = [SEED_STAKING_POOL, collection.key().as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, CollectionStakingPool>,

    #[account(
        mut,
        seeds = [SEED_STAKER_POSITION, staker.key().as_ref(), collection.key().as_ref()],
        bump = staker_position.bump,
        constraint = staker_position.staker == staker.key() @ ProtocolError::Unauthorized
    )]
    pub staker_position: Account<'info, StakerPosition>,

    /// CHECK: Staker's collection token account (destination)
    #[account(mut)]
    pub staker_token_account: UncheckedAccount<'info>,

    /// CHECK: Staking pool's collection token account (source)
    #[account(mut)]
    pub pool_token_account: UncheckedAccount<'info>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Claim accumulated staking rewards
pub fn claim_staking_rewards(ctx: Context<ClaimStakingRewards>) -> Result<()> {
    let staking_pool = &ctx.accounts.staking_pool;
    let staker_position = &mut ctx.accounts.staker_position;

    require!(
        staker_position.amount_staked > 0,
        ProtocolError::InsufficientFunds
    );

    // Calculate pending rewards
    let pending = (staker_position.amount_staked as u128)
        .checked_mul(staking_pool.reward_per_token)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_sub(staker_position.reward_debt)
        .ok_or(ProtocolError::MathOverflow)?;

    let pending_tokens = (pending / REWARD_PRECISION) as u64;
    
    require!(pending_tokens > 0, ProtocolError::InsufficientFunds);

    // Transfer rewards from pool to staker using pool PDA authority
    let collection_key = ctx.accounts.collection.key();
    let pool_seeds = [
        SEED_STAKING_POOL,
        collection_key.as_ref(),
        &[staking_pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    let transfer_to_staker = TransferChecked {
        from: ctx.accounts.pool_token_account.to_account_info(),
        mint: ctx.accounts.collection_mint.to_account_info(),
        to: ctx.accounts.staker_token_account.to_account_info(),
        authority: ctx.accounts.pool_token_account.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_to_staker,
        signer_seeds,
    );
    anchor_spl::token_interface::transfer_checked(cpi_ctx, pending_tokens, ctx.accounts.collection_mint.decimals)?;

    msg!(
        "RewardClaim: Staker={} Collection={} Amount={}",
        ctx.accounts.staker.key(),
        ctx.accounts.collection.collection_id,
        pending_tokens
    );

    // Update reward debt
    staker_position.reward_debt = (staker_position.amount_staked as u128)
        .checked_mul(staking_pool.reward_per_token)
        .ok_or(ProtocolError::MathOverflow)?;

    Ok(())
}

#[derive(Accounts)]
pub struct UnstakeCollectionTokens<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        mut,
        seeds = [SEED_STAKING_POOL, collection.key().as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, CollectionStakingPool>,

    #[account(
        mut,
        seeds = [SEED_STAKER_POSITION, staker.key().as_ref(), collection.key().as_ref()],
        bump = staker_position.bump,
        constraint = staker_position.staker == staker.key() @ ProtocolError::Unauthorized
    )]
    pub staker_position: Account<'info, StakerPosition>,

    /// CHECK: Staker's collection token account (destination)
    #[account(mut)]
    pub staker_token_account: UncheckedAccount<'info>,

    /// CHECK: Staking pool's collection token account (source)
    #[account(mut)]
    pub pool_token_account: UncheckedAccount<'info>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Unstake collection tokens and claim any pending rewards
pub fn unstake_collection_tokens(
    ctx: Context<UnstakeCollectionTokens>,
    amount: u64,
) -> Result<()> {
    let staking_pool = &mut ctx.accounts.staking_pool;
    let staker_position = &mut ctx.accounts.staker_position;

    require!(amount > 0, ProtocolError::InsufficientFunds);
    require!(
        staker_position.amount_staked >= amount,
        ProtocolError::InsufficientFunds
    );

    // Claim any pending rewards first
    let pending = (staker_position.amount_staked as u128)
        .checked_mul(staking_pool.reward_per_token)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_sub(staker_position.reward_debt)
        .ok_or(ProtocolError::MathOverflow)?;

    let pending_tokens = (pending / REWARD_PRECISION) as u64;
    
    // Calculate total amount to transfer: staked tokens + pending rewards
    let total_transfer = amount
        .checked_add(pending_tokens)
        .ok_or(ProtocolError::MathOverflow)?;

    // Transfer staked tokens + rewards back to staker using pool PDA authority
    let collection_key = ctx.accounts.collection.key();
    let pool_seeds = [
        SEED_STAKING_POOL,
        collection_key.as_ref(),
        &[staking_pool.bump],
    ];
    let signer_seeds = &[&pool_seeds[..]];

    let transfer_to_staker = TransferChecked {
        from: ctx.accounts.pool_token_account.to_account_info(),
        mint: ctx.accounts.collection_mint.to_account_info(),
        to: ctx.accounts.staker_token_account.to_account_info(),
        authority: ctx.accounts.pool_token_account.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_to_staker,
        signer_seeds,
    );
    anchor_spl::token_interface::transfer_checked(cpi_ctx, total_transfer, ctx.accounts.collection_mint.decimals)?;

    msg!(
        "Unstake: Staker={} Collection={} StakedAmount={} RewardAmount={} TotalTransferred={}",
        ctx.accounts.staker.key(),
        ctx.accounts.collection.collection_id,
        amount,
        pending_tokens,
        total_transfer
    );

    // Update staking pool
    staking_pool.total_staked = staking_pool.total_staked
        .checked_sub(amount)
        .ok_or(ProtocolError::MathOverflow)?;

    // Update staker position
    staker_position.amount_staked = staker_position.amount_staked
        .checked_sub(amount)
        .ok_or(ProtocolError::MathOverflow)?;

    staker_position.reward_debt = (staker_position.amount_staked as u128)
        .checked_mul(staking_pool.reward_per_token)
        .ok_or(ProtocolError::MathOverflow)?;

    Ok(())
}
