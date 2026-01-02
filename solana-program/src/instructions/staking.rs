// solana-program/programs/solana-program/src/instructions/staking.rs
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

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
    #[account(
        mut,
        constraint = moderator_token_account.owner == moderator.key() @ ProtocolError::Unauthorized
    )]
    pub moderator_token_account: InterfaceAccount<'info, TokenAccount>,

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
    let moderator_token_account = &ctx.accounts.moderator_token_account;

    // Check if stake amount meets minimum requirement
    require!(
        stake_amount >= global_state.moderator_stake_minimum,
        ProtocolError::InsufficientModeratorStake
    );

    // Check if moderator has sufficient balance
    require!(
        moderator_token_account.amount >= stake_amount,
        ProtocolError::InsufficientFunds
    );

    // Update or initialize moderator stake
    moderator_stake.moderator = ctx.accounts.moderator.key();
    moderator_stake.stake_amount = moderator_stake.stake_amount
        .checked_add(stake_amount)
        .ok_or(ProtocolError::MathOverflow)?;
    moderator_stake.is_active = true;
    moderator_stake.bump = ctx.bumps.moderator_stake;

    // In production: Transfer CAPGM tokens to a staking vault via CPI
    // For now, we just track the stake amount

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
