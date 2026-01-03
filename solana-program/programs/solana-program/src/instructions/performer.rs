// solana-program/programs/solana-program/src/instructions/performer.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

#[derive(Accounts)]
pub struct InitializePerformerEscrow<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        init,
        payer = authority,
        space = PerformerEscrow::MAX_SIZE,
        seeds = [SEED_PERFORMER_ESCROW, collection.key().as_ref()],
        bump
    )]
    pub performer_escrow: Account<'info, PerformerEscrow>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_performer_escrow(
    ctx: Context<InitializePerformerEscrow>,
    performer_wallet: Pubkey,
) -> Result<()> {
    let performer_escrow = &mut ctx.accounts.performer_escrow;
    performer_escrow.collection = ctx.accounts.collection.key();
    performer_escrow.performer_wallet = performer_wallet;
    performer_escrow.balance = 0;
    performer_escrow.bump = ctx.bumps.performer_escrow;

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimPerformerEscrow<'info> {
    #[account(mut)]
    pub performer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        mut,
        seeds = [SEED_PERFORMER_ESCROW, collection.key().as_ref()],
        bump,
        constraint = performer_escrow.performer_wallet == performer.key() @ ProtocolError::Unauthorized
    )]
    pub performer_escrow: Account<'info, PerformerEscrow>,

    /// CHECK: Performer's token account to receive funds
    #[account(mut)]
    pub performer_token_account: UncheckedAccount<'info>,
}

pub fn claim_performer_escrow(ctx: Context<ClaimPerformerEscrow>) -> Result<()> {
    let performer_escrow = &mut ctx.accounts.performer_escrow;

    require!(
        performer_escrow.balance > 0,
        ProtocolError::InsufficientFunds
    );

    let claim_amount = performer_escrow.balance;
    performer_escrow.balance = 0;

    // In production: Transfer tokens to performer_token_account via CPI
    // For now, we just reset the balance

    msg!("PerformerEscrowClaimed: Amount={} Performer={}", claim_amount, ctx.accounts.performer.key());

    Ok(())
}
