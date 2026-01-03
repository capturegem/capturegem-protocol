// solana-program/programs/solana-program/src/instructions/performer.rs
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TransferChecked, Mint};
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

    /// CHECK: Performer escrow's token account (source of funds) - must be owned by performer_escrow PDA
    #[account(mut)]
    pub escrow_token_account: UncheckedAccount<'info>,

    /// CHECK: Performer's token account to receive funds (destination)
    #[account(mut)]
    pub performer_token_account: UncheckedAccount<'info>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Claims accumulated performer fees from the PerformerEscrow.
/// 
/// NOTE: Currently, purchase_access splits funds 50/50 between Stakers and Peers.
/// PerformerEscrow is not funded in the current purchase_access flow. If PerformerEscrow
/// is intended to be used, funding logic should be added to purchase_access or another
/// instruction. Otherwise, this escrow mechanism may be deprecated in favor of the
/// CollectionStakingPool for creator revenue (via the 10% token allocation).
pub fn claim_performer_escrow(ctx: Context<ClaimPerformerEscrow>) -> Result<()> {
    // Extract account info and bump before mutable borrow
    let performer_escrow_account_info = ctx.accounts.performer_escrow.to_account_info();
    let performer_escrow_bump = ctx.accounts.performer_escrow.bump;
    
    let performer_escrow = &mut ctx.accounts.performer_escrow;

    require!(
        performer_escrow.balance > 0,
        ProtocolError::InsufficientFunds
    );

    let claim_amount = performer_escrow.balance;

    // Transfer tokens from escrow token account to performer token account using PerformerEscrow PDA as signer
    let collection_key = ctx.accounts.collection.key();
    let escrow_seeds = [
        SEED_PERFORMER_ESCROW,
        collection_key.as_ref(),
        &[performer_escrow_bump],
    ];
    let signer_seeds = &[&escrow_seeds[..]];

    let transfer_ix = TransferChecked {
        from: ctx.accounts.escrow_token_account.to_account_info(),
        mint: ctx.accounts.collection_mint.to_account_info(),
        to: ctx.accounts.performer_token_account.to_account_info(),
        authority: performer_escrow_account_info, // PerformerEscrow PDA is the owner/authority
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_ix,
        signer_seeds,
    );
    anchor_spl::token_interface::transfer_checked(
        cpi_ctx,
        claim_amount,
        ctx.accounts.collection_mint.decimals,
    )?;

    // Reset balance after successful transfer
    performer_escrow.balance = 0;

    msg!(
        "PerformerEscrowClaimed: Amount={} Performer={} Collection={}",
        claim_amount,
        ctx.accounts.performer.key(),
        ctx.accounts.collection.collection_id
    );

    Ok(())
}
