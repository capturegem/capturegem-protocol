// solana-program/programs/solana-program/src/instructions/admin.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init, 
        payer = admin, 
        space = GlobalState::MAX_SIZE,
        seeds = [SEED_GLOBAL_STATE], 
        bump
    )]
    pub global_state: Account<'info, GlobalState>,
    
    /// CHECK: Treasury account that will receive protocol fees
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    
    /// CHECK: CAPGM token mint
    pub capgm_mint: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Initialize the protocol's GlobalState
/// fee_basis_points: Purchase fee in basis points (default: 200 = 2%)
///                    This fee is collected on purchases and can be updated via update_global_state
pub fn initialize_protocol(
    ctx: Context<InitializeGlobal>, 
    indexer_url: String, 
    registry_url: String,
    mod_stake_min: u64,
    fee_basis_points: u16
) -> Result<()> {
    require!(indexer_url.len() <= crate::state::MAX_URL_LEN, crate::errors::ProtocolError::StringTooLong);
    require!(registry_url.len() <= crate::state::MAX_URL_LEN, crate::errors::ProtocolError::StringTooLong);
    require!(fee_basis_points <= 10000, crate::errors::ProtocolError::InvalidFeeConfig); // Max 100%
    
    let state = &mut ctx.accounts.global_state;
    state.admin = ctx.accounts.admin.key();
    state.treasury = ctx.accounts.treasury.key();
    state.indexer_api_url = indexer_url;
    state.node_registry_url = registry_url;
    state.moderator_stake_minimum = mod_stake_min;
    state.capgm_mint = ctx.accounts.capgm_mint.key();
    state.fee_basis_points = fee_basis_points; // Purchase fee (default: 200 = 2%)
    state.updates_disabled = false; // Initially, updates are enabled
    state.bump = ctx.bumps.global_state;
    
    msg!("Protocol initialized with purchase fee: {} basis points ({}%)", fee_basis_points, fee_basis_points as f64 / 100.0);
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateGlobalState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump,
        constraint = global_state.admin == admin.key() @ crate::errors::ProtocolError::Unauthorized,
        constraint = !global_state.updates_disabled @ crate::errors::ProtocolError::Unauthorized
    )]
    pub global_state: Account<'info, GlobalState>,
    
    /// CHECK: New treasury account (pass same as current treasury if not updating)
    pub new_treasury: UncheckedAccount<'info>,
    
    /// CHECK: New CAPGM mint (pass same as current capgm_mint if not updating)
    pub new_capgm_mint: UncheckedAccount<'info>,
}

/// Update GlobalState fields. Only the admin can call this, and only if updates are not disabled.
/// All parameters are optional - only provided fields will be updated.
/// 
/// fee_basis_points: Purchase fee in basis points (e.g., 200 = 2%, 150 = 1.5%)
///                   This fee is collected on purchases and sent to the treasury.
///                   Must be <= 10000 (100% max).
pub fn update_global_state(
    ctx: Context<UpdateGlobalState>,
    indexer_url: Option<String>,
    registry_url: Option<String>,
    mod_stake_min: Option<u64>,
    fee_basis_points: Option<u16>,
) -> Result<()> {
    let state = &mut ctx.accounts.global_state;
    
    // Update fields only if new values are provided
    if let Some(url) = indexer_url {
        require!(url.len() <= crate::state::MAX_URL_LEN, crate::errors::ProtocolError::StringTooLong);
        state.indexer_api_url = url;
    }
    
    if let Some(url) = registry_url {
        require!(url.len() <= crate::state::MAX_URL_LEN, crate::errors::ProtocolError::StringTooLong);
        state.node_registry_url = url;
    }
    
    if let Some(stake_min) = mod_stake_min {
        state.moderator_stake_minimum = stake_min;
    }
    
    if let Some(fee_bp) = fee_basis_points {
        require!(fee_bp <= 10000, crate::errors::ProtocolError::InvalidFeeConfig); // Max 100%
        let old_fee = state.fee_basis_points;
        state.fee_basis_points = fee_bp;
        msg!("Purchase fee updated: {} -> {} basis points ({}% -> {}%)", 
             old_fee, fee_bp, 
             old_fee as f64 / 100.0, 
             fee_bp as f64 / 100.0);
    }
    
    // Update treasury if a different account is provided
    if ctx.accounts.new_treasury.key() != state.treasury {
        state.treasury = ctx.accounts.new_treasury.key();
    }
    
    // Update CAPGM mint if a different account is provided
    if ctx.accounts.new_capgm_mint.key() != state.capgm_mint {
        state.capgm_mint = ctx.accounts.new_capgm_mint.key();
    }
    
    msg!("GlobalState updated by admin: {}", ctx.accounts.admin.key());
    Ok(())
}

#[derive(Accounts)]
pub struct DisableGlobalStateUpdates<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump,
        constraint = global_state.admin == admin.key() @ crate::errors::ProtocolError::Unauthorized,
        constraint = !global_state.updates_disabled @ crate::errors::ProtocolError::Unauthorized
    )]
    pub global_state: Account<'info, GlobalState>,
}

/// Permanently disable all future updates to GlobalState.
/// This is a one-way operation - once disabled, updates cannot be re-enabled.
/// Use this to lock the protocol configuration after initial setup and testing.
pub fn disable_global_state_updates(ctx: Context<DisableGlobalStateUpdates>) -> Result<()> {
    let state = &mut ctx.accounts.global_state;
    state.updates_disabled = true;
    
    msg!("GlobalState updates permanently disabled by admin: {}", ctx.accounts.admin.key());
    msg!("WARNING: This action cannot be undone. GlobalState is now immutable.");
    
    Ok(())
}
