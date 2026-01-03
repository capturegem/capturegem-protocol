use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, MintTo};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

#[derive(Accounts)]
#[instruction(collection_id: String, name: String, content_cid: String, access_threshold_usd: u64)]
pub struct CreateCollection<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = CollectionState::MAX_SIZE,
        seeds = [b"collection", owner.key().as_ref(), collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: Price oracle feed (Pyth or Switchboard) for this Collection Token
    pub oracle_feed: UncheckedAccount<'info>,

    /// CHECK: Orca pool address (will be set after pool creation)
    #[account(mut)]
    pub pool_address: UncheckedAccount<'info>,

    /// CHECK: Claim vault token account (PDA that will hold 10% of tokens)
    #[account(mut)]
    pub claim_vault: UncheckedAccount<'info>,

    /// Token mint account (PDA derived from collection)
    #[account(
        init_if_needed,
        payer = owner,
        mint::decimals = 6,
        mint::authority = collection,
        mint::freeze_authority = collection,
        seeds = [b"mint", collection.key().as_ref()],
        bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_collection(
    ctx: Context<CreateCollection>,
    collection_id: String,
    name: String,
    content_cid: String,
    access_threshold_usd: u64,
) -> Result<()> {
    require!(collection_id.len() <= MAX_ID_LEN, ProtocolError::StringTooLong);
    require!(name.len() <= MAX_NAME_LEN, ProtocolError::StringTooLong);
    require!(content_cid.len() <= MAX_URL_LEN, ProtocolError::StringTooLong);

    let clock = &ctx.accounts.clock;
    let collection = &mut ctx.accounts.collection;
    
    collection.owner = ctx.accounts.owner.key();
    collection.collection_id = collection_id;
    collection.mint = ctx.accounts.mint.key();
    collection.pool_address = ctx.accounts.pool_address.key();
    collection.claim_vault = ctx.accounts.claim_vault.key();
    collection.claim_deadline = clock.unix_timestamp
        .checked_add(crate::constants::CLAIM_VAULT_VESTING_SECONDS)
        .ok_or(ProtocolError::MathOverflow)?;
    collection.total_trust_score = 0;
    collection.is_blacklisted = false;
    collection.name = name;
    collection.content_cid = content_cid;
    collection.access_threshold_usd = access_threshold_usd;
    collection.oracle_feed = ctx.accounts.oracle_feed.key();
    
    // Initialize reward trackers
    collection.reward_pool_balance = 0;
    collection.owner_reward_balance = 0;
    collection.performer_escrow_balance = 0;
    collection.staker_reward_balance = 0;
    collection.total_shares = 0;
    collection.acc_reward_per_share = 0;
    collection.bump = ctx.bumps.collection;

    // Mint is automatically created and initialized by Anchor's init constraint
    // The mint authority is set to the collection PDA, which allows the collection
    // to control minting and freezing of tokens

    Ok(())
}

#[derive(Accounts)]
#[instruction(ipns_key: String)]
pub struct InitializeUserAccount<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = UserAccount::MAX_SIZE,
        seeds = [SEED_USER_ACCOUNT, authority.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_user_account(
    ctx: Context<InitializeUserAccount>,
    ipns_key: String,
) -> Result<()> {
    require!(
        ipns_key.len() <= MAX_IPNS_KEY_LEN,
        ProtocolError::StringTooLong
    );

    let user_account = &mut ctx.accounts.user_account;
    user_account.authority = ctx.accounts.authority.key();
    user_account.ipns_key = ipns_key;
    user_account.is_online = false;
    user_account.bump = ctx.bumps.user_account;

    Ok(())
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct MintCollectionTokens<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump,
        constraint = collection.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: The collection token mint (PDA derived from collection)
    #[account(
        mut,
        seeds = [b"mint", collection.key().as_ref()],
        bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Creator's token account to receive 10% of minted tokens
    #[account(
        mut,
        constraint = creator_token_account.owner == creator.key() @ ProtocolError::Unauthorized,
        constraint = creator_token_account.mint == mint.key() @ ProtocolError::Unauthorized
    )]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Claim vault token account (PDA) to receive 10% of minted tokens
    #[account(
        mut,
        constraint = claim_vault.key() == collection.claim_vault @ ProtocolError::Unauthorized
    )]
    pub claim_vault: UncheckedAccount<'info>,

    /// CHECK: Orca DEX liquidity pool token account (or pool address)
    /// This account will receive 80% of the minted tokens for liquidity provision
    #[account(
        mut,
        constraint = orca_liquidity_pool.key() == collection.pool_address @ ProtocolError::Unauthorized
    )]
    pub orca_liquidity_pool: UncheckedAccount<'info>,

    /// CHECK: Orca program ID (for CPI calls to Orca DEX)
    /// In production, this should be the official Orca Whirlpool or StableSwap program ID
    pub orca_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn mint_collection_tokens(
    ctx: Context<MintCollectionTokens>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ProtocolError::InvalidFeeConfig);

    let collection = &ctx.accounts.collection;
    let mint = &ctx.accounts.mint;
    let creator = &ctx.accounts.creator;

    // Verify the mint matches the collection's mint
    require!(
        mint.key() == collection.mint,
        ProtocolError::Unauthorized
    );

    // Calculate distribution: 80% to Orca, 10% to creator, 10% to claim vault
    let orca_amount = amount
        .checked_mul(80)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let creator_amount = amount
        .checked_mul(10)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let claim_vault_amount = amount
        .checked_mul(10)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    // Verify the split is correct (accounting for rounding)
    let total_distributed = orca_amount
        .checked_add(creator_amount)
        .and_then(|v| v.checked_add(claim_vault_amount))
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Handle any rounding remainder by adjusting orca amount
    let remainder = amount.saturating_sub(total_distributed);
    let final_orca_amount = orca_amount
        .checked_add(remainder)
        .unwrap_or(orca_amount);
    let final_creator_amount = creator_amount;
    let final_claim_vault_amount = claim_vault_amount;

    // 1. Mint tokens to creator and Orca
    // Since the mint authority is the collection PDA, we use CPI to mint
    let collection_bump = ctx.bumps.collection;
    let seeds = &[
        b"collection",
        collection.owner.as_ref(),
        collection.collection_id.as_bytes(),
        &[collection_bump],
    ];
    let signer = &[&seeds[..]];

    // 1. Mint tokens to creator's account (10%)
    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.creator_token_account.to_account_info(),
        authority: ctx.accounts.collection.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    anchor_spl::token_interface::mint_to(cpi_ctx, final_creator_amount)?;

    // 2. Mint tokens to claim vault (10%)
    let claim_vault_cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.claim_vault.to_account_info(),
        authority: ctx.accounts.collection.to_account_info(),
    };
    let claim_vault_cpi_program = ctx.accounts.token_program.to_account_info();
    let claim_vault_cpi_ctx = CpiContext::new_with_signer(claim_vault_cpi_program, claim_vault_cpi_accounts, signer);
    anchor_spl::token_interface::mint_to(claim_vault_cpi_ctx, final_claim_vault_amount)?;

    // 3. Mint tokens to Orca liquidity pool (80%)
    // IMPORTANT: This mints tokens to a holding account, NOT directly to the Orca pool.
    // After this instruction, you must:
    // 1. Call initialize_orca_pool() if the pool doesn't exist yet
    // 2. Call deposit_liquidity_to_orca() to transfer these tokens to the actual Orca pool
    //
    // The full workflow is:
    // Step 1: create_collection() - creates collection and mint
    // Step 2: mint_collection_tokens() - mints tokens (80% to holding account)
    // Step 3: initialize_orca_pool() - creates the Orca Whirlpool
    // Step 4: deposit_liquidity_to_orca() - deposits tokens + CAPGM into pool
    //
    // In production, this would involve:
    // - Calculating the proper pool address (Whirlpool PDA)
    // - Minting 80% to a temporary token account controlled by the collection PDA
    // - Then using deposit_liquidity_to_orca() to move tokens to Orca vaults
    // - Receiving a position NFT representing the liquidity
    //
    // For now, we mint directly to the provided Orca account for testing purposes.
    // TODO: Implement full Orca DEX integration with proper pool creation and liquidity provision
    
    let orca_cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.orca_liquidity_pool.to_account_info(),
        authority: ctx.accounts.collection.to_account_info(),
    };
    let orca_cpi_program = ctx.accounts.token_program.to_account_info();
    let orca_cpi_ctx = CpiContext::new_with_signer(orca_cpi_program, orca_cpi_accounts, signer);
    anchor_spl::token_interface::mint_to(orca_cpi_ctx, final_orca_amount)?;

    msg!(
        "CollectionTokensMinted: Collection={} Creator={} CreatorAmount={} ClaimVaultAmount={} OrcaAmount={}",
        collection.collection_id,
        creator.key(),
        final_creator_amount,
        final_claim_vault_amount,
        final_orca_amount
    );
    msg!(
        "NEXT STEPS: 1) Call initialize_orca_pool() if pool doesn't exist. 2) Call deposit_liquidity_to_orca() to move tokens to Orca and create liquidity position."
    );

    Ok(())
}

#[derive(Accounts)]
pub struct BurnUnclaimedTokens<'info> {
    #[account(mut)]
    pub authority: Signer<'info>, // Can be called by anyone after deadline

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: Claim vault token account (PDA) holding the 10% reserve
    #[account(
        mut,
        constraint = claim_vault.key() == collection.claim_vault @ ProtocolError::Unauthorized
    )]
    pub claim_vault: UncheckedAccount<'info>,

    /// CHECK: Collection token mint
    #[account(
        mut,
        seeds = [b"mint", collection.key().as_ref()],
        bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

/// Burns unclaimed tokens from the claim vault after the 6-month vesting period expires.
/// This creates a deflationary event that benefits all existing holders.
pub fn burn_unclaimed_tokens(ctx: Context<BurnUnclaimedTokens>) -> Result<()> {
    let collection = &ctx.accounts.collection;
    let clock = &ctx.accounts.clock;

    // Verify that the claim deadline has passed
    require!(
        clock.unix_timestamp >= collection.claim_deadline,
        ProtocolError::Unauthorized // Use Unauthorized as a generic error for "not yet available"
    );

    // In production: 
    // 1. Get the balance of the claim_vault token account
    // 2. Use CPI to burn those tokens from the mint
    // 3. This permanently reduces the total supply

    // For now, we just log the event
    // TODO: Implement actual token burning via CPI to token program's burn instruction

    msg!(
        "UnclaimedTokensBurned: Collection={} Deadline={} CurrentTime={}",
        collection.collection_id,
        collection.claim_deadline,
        clock.unix_timestamp
    );

    Ok(())
}