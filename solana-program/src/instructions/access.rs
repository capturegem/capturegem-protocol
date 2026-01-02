use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, MintTo};
use crate::state::*;
use crate::errors::ProtocolError;

#[derive(Accounts)]
pub struct BuyAccess<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: In production this would be a Pyth or Switchboard aggregator account
    pub oracle_feed: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn buy_access_token(ctx: Context<BuyAccess>) -> Result<()> {
    let collection = &ctx.accounts.collection;
    let access_price_usd_cents = collection.access_price; // e.g. 500 = $5.00

    // 1. Get Price from Oracle (Mock)
    // In production: Use pyth_sdk_solana::load_price_feed_from_account_info
    let sol_price_usd = 150_00; // Mock: $150.00
    
    if sol_price_usd <= 0 {
        return err!(ProtocolError::InvalidOraclePrice);
    }

    // 2. Calculate SOL required
    // Required SOL = Access Price / SOL Price
    // Example: $5.00 / $150.00 = 0.0333 SOL
    let sol_required_lamports = (access_price_usd_cents as u128)
        .checked_mul(1_000_000_000) // to lamports
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(sol_price_usd as u128)
        .ok_or(ProtocolError::MathOverflow)?;

    // 3. Transfer SOL from payer to Collection Treasury (or directly to reward pool)
    let transfer_instruction = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.payer.key(),
        &collection.key(), // Sending to collection PDA for simplicity (reward pool)
        sol_required_lamports as u64,
    );
    
    anchor_lang::solana_program::program::invoke(
        &transfer_instruction,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // 4. Mint Access Token to Buyer
    let seeds = &[
        b"collection",
        collection.collection_id.as_bytes(),
        &[ctx.bumps.collection],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.buyer_token_account.to_account_info(),
        authority: ctx.accounts.collection.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(), 
        cpi_accounts, 
        signer
    );
    
    // Mint 1 token (decimals = 0)
    anchor_spl::token::mint_to(cpi_ctx, 1)?;

    Ok(())
}
