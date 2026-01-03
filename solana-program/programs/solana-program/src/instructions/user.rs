use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, MintTo};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

#[derive(Accounts)]
#[instruction(collection_id: String, name: String, cid_hash: [u8; 32], access_threshold_usd: u64)]
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
    cid_hash: [u8; 32],
    access_threshold_usd: u64,
) -> Result<()> {
    require!(collection_id.len() <= MAX_ID_LEN, ProtocolError::StringTooLong);
    require!(name.len() <= MAX_NAME_LEN, ProtocolError::StringTooLong);

    let clock = &ctx.accounts.clock;
    let collection = &mut ctx.accounts.collection;
    
    let owner_key = ctx.accounts.owner.key();
    collection.owner = owner_key;
    collection.collection_id = collection_id.clone();
    collection.cid_hash = cid_hash;
    collection.mint = ctx.accounts.mint.key();
    collection.pool_address = ctx.accounts.pool_address.key();
    collection.claim_vault = ctx.accounts.claim_vault.key();
    collection.claim_deadline = clock.unix_timestamp
        .checked_add(crate::constants::CLAIM_VAULT_VESTING_SECONDS)
        .ok_or(ProtocolError::MathOverflow)?;
    collection.total_trust_score = 0;
    collection.is_blacklisted = false;
    collection.name = name;
    collection.content_cid = String::from(""); // Deprecated field, kept for backward compatibility
    collection.access_threshold_usd = access_threshold_usd;
    collection.oracle_feed = ctx.accounts.oracle_feed.key();
    
    // Initialize reward trackers
    collection.reward_pool_balance = 0;
    collection.owner_reward_balance = 0;
    collection.performer_escrow_balance = 0;
    collection.staker_reward_balance = 0;
    collection.total_shares = 0;
    collection.acc_reward_per_share = 0;
    collection.tokens_minted = false; // Tokens not yet minted
    collection.bump = ctx.bumps.collection;

    // Mint is automatically created and initialized by Anchor's init constraint
    // The mint authority is set to the collection PDA, which allows the collection
    // to control minting and freezing of tokens

    msg!(
        "CollectionCreated: ID={} Owner={} CidHashSet=true",
        collection_id,
        owner_key
    );

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
        bump = collection.bump,
        constraint = collection.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    /// The collection token mint (PDA derived from collection)
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
    /// Validated by constraint against collection.claim_vault
    #[account(
        mut,
        constraint = claim_vault.key() == collection.claim_vault @ ProtocolError::Unauthorized
    )]
    pub claim_vault: UncheckedAccount<'info>,

    /// ✅ CORRECTED: Liquidity Reserve Account (receives 80%)
    /// 
    /// This is an Associated Token Account (ATA) owned by the Collection PDA.
    /// It acts as a "staging" or "reserve" wallet for the protocol.
    /// 
    /// ⚠️ IMPORTANT: You CANNOT mint directly to an Orca Pool address because:
    /// 1. The Whirlpool PDA is a data account, not a token account
    /// 2. Even minting to Orca's vault wouldn't update liquidity state
    /// 3. You wouldn't receive a position NFT
    /// 
    /// The correct workflow is:
    /// 1. Mint 80% here (to liquidity_reserve)
    /// 2. Call initialize_orca_pool() to create the pool
    /// 3. Call deposit_liquidity_to_orca() to move tokens from here → Orca
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = collection,
    )]
    pub liquidity_reserve: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Mint collection tokens with automatic 3-way distribution:
/// - 10% to Creator
/// - 10% to Claim Vault (for performer/contributor claims)
/// - 80% to Liquidity Reserve (staging area for Orca pool)
/// 
/// ⚠️ CRITICAL: This does NOT directly add liquidity to Orca!
/// 
/// The 80% is minted to a "staging" account (liquidity_reserve) owned by the Collection PDA.
/// To actually create liquidity on Orca, you must follow this workflow:
/// 
/// 1. **This instruction**: Mints 80% to `liquidity_reserve` (Collection's ATA)
/// 2. **initialize_orca_pool()**: Creates the Whirlpool on Orca
/// 3. **deposit_liquidity_to_orca()**: Transfers tokens from `liquidity_reserve` → Orca pool
/// 
/// Why we can't mint directly to Orca:
/// - Orca's Whirlpool address is a data account, not a token account
/// - Minting to Orca's vault wouldn't update liquidity state or position tracking
/// - You wouldn't receive a position NFT representing your liquidity
/// 
/// This multi-step approach is necessary due to:
/// - Compute Unit limits (each step is expensive)
/// - Transaction size limits (Orca requires many accounts)
/// - Proper position NFT issuance
pub fn mint_collection_tokens(
    ctx: Context<MintCollectionTokens>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ProtocolError::InvalidFeeConfig);

    // Get values before mutable borrow
    let collection_account_info = ctx.accounts.collection.to_account_info();
    let collection_owner = ctx.accounts.collection.owner;
    let collection_id = ctx.accounts.collection.collection_id.clone();
    let collection_bump = ctx.accounts.collection.bump;
    let collection_mint = ctx.accounts.collection.mint;
    let tokens_minted = ctx.accounts.collection.tokens_minted;
    let mint = &ctx.accounts.mint;

    // ⚠️ SECURITY: Enforce one-time minting per collection
    // According to the design doc, collection tokens should only be minted once ever per collection
    require!(
        !tokens_minted,
        ProtocolError::Unauthorized // Tokens already minted for this collection
    );

    // Verify the mint matches the collection's mint
    require!(
        mint.key() == collection_mint,
        ProtocolError::Unauthorized
    );

    // Calculate distribution: 80% to reserve, 10% to creator, 10% to claim vault
    let reserve_amount = amount
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
    let total_distributed = reserve_amount
        .checked_add(creator_amount)
        .and_then(|v| v.checked_add(claim_vault_amount))
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Handle any rounding remainder by adjusting reserve amount
    let remainder = amount.saturating_sub(total_distributed);
    let final_reserve_amount = reserve_amount
        .checked_add(remainder)
        .unwrap_or(reserve_amount);

    // Prepare PDA signer seeds (Collection PDA is the mint authority)
    let seeds = &[
        b"collection",
        collection_owner.as_ref(),
        collection_id.as_bytes(),
        &[collection_bump],
    ];
    let signer = &[&seeds[..]];

    // 1. Mint 10% to creator's token account
    let creator_cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.creator_token_account.to_account_info(),
        authority: collection_account_info.clone(),
    };
    let creator_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        creator_cpi_accounts,
        signer
    );
    anchor_spl::token_interface::mint_to(creator_cpi_ctx, creator_amount)?;

    // 2. Mint 10% to claim vault
    let vault_cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.claim_vault.to_account_info(),
        authority: collection_account_info.clone(),
    };
    let vault_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        vault_cpi_accounts,
        signer
    );
    anchor_spl::token_interface::mint_to(vault_cpi_ctx, claim_vault_amount)?;

    // 3. Mint 80% to liquidity reserve (staging account for Orca)
    // These tokens sit here until deposit_liquidity_to_orca() is called
    let reserve_cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.liquidity_reserve.to_account_info(),
        authority: collection_account_info.clone(),
    };
    let reserve_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        reserve_cpi_accounts,
        signer
    );
    anchor_spl::token_interface::mint_to(reserve_cpi_ctx, final_reserve_amount)?;

    // Mark tokens as minted (one-time operation - cannot mint again)
    let collection = &mut ctx.accounts.collection;
    collection.tokens_minted = true;

    msg!(
        "CollectionTokensMinted: Collection={} Mint={} TotalAmount={}",
        collection_id,
        mint.key(),
        amount
    );
    msg!(
        "Distribution: Creator={}(10%) ClaimVault={}(10%) LiquidityReserve={}(80%)",
        creator_amount,
        claim_vault_amount,
        final_reserve_amount
    );
    msg!(
        "NEXT STEPS: 1) initialize_orca_pool() to create Whirlpool. 2) deposit_liquidity_to_orca() to move tokens from reserve → Orca."
    );
    msg!(
        "SECURITY: Tokens marked as minted - this collection cannot mint tokens again"
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