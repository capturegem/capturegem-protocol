use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, MintTo, Burn, burn};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;
use spl_token_2022::extension::ExtensionType;
use spl_token_2022::instruction::initialize_mint;

#[derive(Accounts)]
#[instruction(collection_id: String, name: String, cid_hash: [u8; 32], access_threshold_usd: u64, total_videos: u16)]
pub struct CreateCollection<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        // Calculate space dynamically based on bitmap size
        // Base size + (total_videos / 8 + 1) * 2 for claimed/censored bitmaps
        space = CollectionState::BASE_SIZE + ((total_videos as usize + 7) / 8) * 2,
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

    /// CHECK: Manual creation to support Transfer Fee Extension
    #[account(
        mut,
        seeds = [b"mint", collection.key().as_ref()],
        bump
    )]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: The DAO Treasury that will receive withheld fees
    /// Validated against GlobalState treasury
    pub treasury: UncheckedAccount<'info>,

    /// Global state account containing the protocol treasury address
    #[account(
        seeds = [crate::constants::SEED_GLOBAL_STATE],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// CHECK: Token-2022 program (required for Transfer Fee Extension)
    #[account(address = spl_token_2022::ID)]
    pub token_program: UncheckedAccount<'info>,
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
    total_videos: u16,
) -> Result<()> {
    require!(collection_id.len() <= MAX_ID_LEN, ProtocolError::StringTooLong);
    require!(name.len() <= MAX_NAME_LEN, ProtocolError::StringTooLong);
    require!(total_videos > 0, ProtocolError::InvalidFeeConfig);
    
    // Validate that the treasury matches the GlobalState treasury
    require!(
        ctx.accounts.treasury.key() == ctx.accounts.global_state.treasury,
        ProtocolError::Unauthorized
    );

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
    collection.owner_reward_balance = 0;
    collection.staker_reward_balance = 0;
    collection.tokens_minted = false; // Tokens not yet minted
    
    // Initialize proportional copyright claim fields
    collection.total_videos = total_videos;
    collection.claim_vault_initial_amount = 0; // Will be set during minting
    // Initialize bitmaps with 0s (size = ceil(total_videos / 8))
    let bitmap_size = (total_videos as usize + 7) / 8;
    collection.claimed_bitmap = vec![0; bitmap_size];
    collection.censored_bitmap = vec![0; bitmap_size];
    
    collection.bump = ctx.bumps.collection;

    // --- MANUAL MINT CREATION (NO TRANSFER FEE EXTENSION) ---
    // NOTE: Transfer fees are now manually collected only on purchases/sales,
    // not on staking or normal transfers. This allows fees to be selective.

    // 1. Calculate space required for Mint (standard Token-2022, no extensions)
    let space = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(
        &[], // No extensions
    ).map_err(|_| ProtocolError::MathOverflow)?;

    // 2. Calculate Rent
    let rent_lamports = ctx.accounts.rent.minimum_balance(space);
    let space_u64 = u64::try_from(space).map_err(|_| ProtocolError::MathOverflow)?;

    // 3. Prepare Seeds for Signing (Mint is a PDA of Collection)
    let seeds = [
        b"mint".as_ref(),
        ctx.accounts.collection.to_account_info().key.as_ref(),
        &[ctx.bumps.mint],
    ];
    let signer = &[&seeds[..]];

    // 4. Create the Account (System Program CPI)
    anchor_lang::solana_program::program::invoke_signed(
        &anchor_lang::solana_program::system_instruction::create_account(
            ctx.accounts.owner.key,
            ctx.accounts.mint.key,
            rent_lamports,
            space_u64,
            ctx.accounts.token_program.key,
        ),
        &[
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer,
    )?;

    // 5. Initialize the Mint (Standard Token-2022, no transfer fee extension)
    anchor_lang::solana_program::program::invoke_signed(
        &initialize_mint(
            ctx.accounts.token_program.key,
            ctx.accounts.mint.key,
            &ctx.accounts.collection.key(), // Mint Authority
            Some(&ctx.accounts.collection.key()), // Freeze Authority
            6, // Decimals
        )?,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ],
        signer,
    )?;

    // --- MANUAL MINT CREATION END ---

    msg!(
        "CollectionCreated: ID={} Owner={} CidHashSet=true Mint={} ManualFees=ConfigurableViaGlobalState",
        collection_id,
        owner_key,
        ctx.accounts.mint.key()
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
    let seeds = [
        b"collection".as_ref(),
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
    // SNAPSHOT THE INITIAL AMOUNT for proportional claim calculations
    let collection = &mut ctx.accounts.collection;
    collection.claim_vault_initial_amount = claim_vault_amount;
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

    /// Claim vault PDA (authority for the token account)
    #[account(
        seeds = [SEED_CLAIM_VAULT, collection.key().as_ref()],
        bump
    )]
    pub claim_vault_pda: UncheckedAccount<'info>,

    /// Claim vault token account (ATA owned by claim_vault PDA) holding the 10% reserve
    #[account(
        mut,
        constraint = claim_vault.key() == collection.claim_vault @ ProtocolError::Unauthorized,
        constraint = claim_vault.mint == mint.key() @ ProtocolError::Unauthorized
    )]
    pub claim_vault: InterfaceAccount<'info, TokenAccount>,

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

    // Get the balance of the claim_vault token account
    let claim_vault_account = &ctx.accounts.claim_vault;
    let amount_to_burn = claim_vault_account.amount;
    
    require!(
        amount_to_burn > 0,
        ProtocolError::InsufficientFunds
    );

    // Derive the claim_vault PDA seeds for signing
    // The claim_vault PDA owns the token account and must sign the burn
    let collection_key = collection.key();
    let claim_vault_seeds = &[
        SEED_CLAIM_VAULT,
        collection_key.as_ref(),
        &[ctx.bumps.claim_vault_pda],
    ];
    let signer_seeds = &[&claim_vault_seeds[..]];

    // Burn the tokens permanently (reduces collection token supply)
    let burn_ix = Burn {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.claim_vault.to_account_info(),
        authority: ctx.accounts.claim_vault_pda.to_account_info(), // claim_vault PDA is the authority
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        burn_ix,
        signer_seeds,
    );
    burn(cpi_ctx, amount_to_burn)?;

    msg!(
        "UnclaimedTokensBurned: Collection={} Deadline={} CurrentTime={} AmountBurned={}",
        collection.collection_id,
        collection.claim_deadline,
        clock.unix_timestamp,
        amount_to_burn
    );

    Ok(())
}