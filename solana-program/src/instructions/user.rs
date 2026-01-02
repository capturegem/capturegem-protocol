use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{self, InitializeMint, InitializeTransferFeeConfig},
    token_interface::{Mint, TokenInterface},
};
use crate::state::*;
use crate::errors::ProtocolError;

#[derive(Accounts)]
#[instruction(collection_id: String, name: String, content_cid: String, access_price: u64)]
pub struct CreateCollection<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 36 + 54 + 64 + 8 + 8 + 8 + 16, // Adjusted for new fields
        seeds = [b"collection", collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 0,
        mint::authority = collection, // The PDA controls the mint
        mint::token_program = token_program,
        extensions::transfer_fee_config::authority = collection,
        extensions::transfer_fee_config::withdraw_authority = collection,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_collection(
    ctx: Context<CreateCollection>,
    collection_id: String,
    name: String,
    content_cid: String,
    access_price: u64,
) -> Result<()> {
    require!(collection_id.len() <= MAX_ID_LEN, ProtocolError::StringTooLong);
    require!(name.len() <= MAX_NAME_LEN, ProtocolError::StringTooLong);
    require!(content_cid.len() <= MAX_URL_LEN, ProtocolError::StringTooLong);

    let collection = &mut ctx.accounts.collection;
    collection.authority = ctx.accounts.authority.key();
    collection.mint = ctx.accounts.mint.key();
    collection.collection_id = collection_id;
    collection.name = name;
    collection.content_cid = content_cid;
    collection.access_price = access_price;
    
    // Initialize reward trackers
    collection.reward_pool_balance = 0;
    collection.total_shares = 0;
    collection.acc_reward_per_share = 0;

    // Initialize Transfer Fee Config (Token 2022)
    // We set a 10% fee (1000 basis points) max, strictly for demonstration
    let fee_basis_points = 1000; 
    let max_fee = u64::MAX;

    let seeds = &[
        b"collection",
        collection.collection_id.as_bytes(),
        &[ctx.bumps.collection],
    ];
    let signer = &[&seeds[..]];

    // 1. Initialize Transfer Fee Config
    let cpi_accounts_config = InitializeTransferFeeConfig {
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_ctx_config = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts_config,
        signer
    );
    token_2022::initialize_transfer_fee_config(
        cpi_ctx_config,
        Some(&collection.key()),
        Some(&collection.key()),
        fee_basis_points,
        max_fee,
    )?;

    // 2. Initialize Mint (Standard)
    let cpi_accounts_mint = InitializeMint {
        mint: ctx.accounts.mint.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };
    let cpi_ctx_mint = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts_mint,
        signer
    );
    token_2022::initialize_mint(cpi_ctx_mint, 0, &collection.key(), None)?;

    Ok(())
}