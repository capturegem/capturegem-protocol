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

pub fn initialize_protocol(
    ctx: Context<InitializeGlobal>, 
    indexer_url: String, 
    registry_url: String,
    mod_stake_min: u64,
    fee_basis_points: u16
) -> Result<()> {
    require!(indexer_url.len() <= crate::state::MAX_URL_LEN, crate::errors::ProtocolError::StringTooLong);
    require!(registry_url.len() <= crate::state::MAX_URL_LEN, crate::errors::ProtocolError::StringTooLong);
    
    let state = &mut ctx.accounts.global_state;
    state.admin = ctx.accounts.admin.key();
    state.treasury = ctx.accounts.treasury.key();
    state.indexer_api_url = indexer_url;
    state.node_registry_url = registry_url;
    state.moderator_stake_minimum = mod_stake_min;
    state.capgm_mint = ctx.accounts.capgm_mint.key();
    state.fee_basis_points = fee_basis_points;
    state.bump = ctx.bumps.global_state;
    Ok(())
}
