use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::ProtocolError;

// Import Orca Whirlpool client SDK
// This provides CPI-ready instructions and account structures
use orca_whirlpools_client::instructions as orca_ix;
use orca_whirlpools_client::accounts as orca_accounts;

/// Orca Whirlpool Program ID (Mainnet/Devnet)
pub const ORCA_WHIRLPOOL_PROGRAM_ID: Pubkey = solana_program::pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

#[derive(Accounts)]
pub struct InitializeOrcaPool<'info> {
    /// Creator of the pool (pays for accounts)
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Collection state account
    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump = collection.bump,
        constraint = collection.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    /// The collection token mint (token A)
    #[account(
        constraint = collection_mint.key() == collection.mint @ ProtocolError::Unauthorized
    )]
    pub collection_mint: InterfaceAccount<'info, Mint>,

    /// CAPGM token mint (token B - the quote currency)
    pub capgm_mint: InterfaceAccount<'info, Mint>,

    /// Whirlpool config account (contains fee tiers and protocol settings)
    /// CHECK: Validated by Orca program
    pub whirlpool_config: UncheckedAccount<'info>,

    /// The whirlpool account to be initialized
    /// CHECK: PDA derived from Orca program, validated by Orca
    #[account(
        mut,
        constraint = whirlpool.key() == collection.pool_address @ ProtocolError::Unauthorized
    )]
    pub whirlpool: UncheckedAccount<'info>,

    /// Token vault A for collection tokens
    /// CHECK: Created and managed by Orca program
    #[account(mut)]
    pub token_vault_a: UncheckedAccount<'info>,

    /// Token vault B for CAPGM tokens
    /// CHECK: Created and managed by Orca program
    #[account(mut)]
    pub token_vault_b: UncheckedAccount<'info>,

    /// Fee tier configuration
    /// CHECK: Validated by Orca program
    pub fee_tier: UncheckedAccount<'info>,

    /// CHECK: Orca Whirlpool program
    #[account(address = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize an Orca Whirlpool for the collection token paired with CAPGM
/// 
/// Uses the official Orca Whirlpools SDK to create a concentrated liquidity pool.
/// 
/// ⚠️  IMPORTANT: Calculate `initial_sqrt_price` CLIENT-SIDE using @orca-so/whirlpools-sdk
/// 
/// Parameters:
/// - tick_spacing: Determines price granularity (1, 64, or 128)
/// - initial_sqrt_price: Initial price in Q64.64 format (calculate with PriceMath.priceToSqrtPriceX64)
pub fn initialize_orca_pool(
    ctx: Context<InitializeOrcaPool>,
    tick_spacing: u16,
    initial_sqrt_price: u128,
) -> Result<()> {
    msg!("Initializing Orca Whirlpool using official SDK");
    msg!("Collection: {}", ctx.accounts.collection.collection_id);
    msg!("Pool: {}", ctx.accounts.whirlpool.key());
    msg!("Tick Spacing: {}", tick_spacing);
    msg!("Initial Sqrt Price: {}", initial_sqrt_price);

    // Build the initialize_pool_v2 instruction using Orca SDK
    let ix = orca_ix::InitializePoolV2 {
        whirlpools_config: ctx.accounts.whirlpool_config.key(),
        token_mint_a: ctx.accounts.collection_mint.key(),
        token_mint_b: ctx.accounts.capgm_mint.key(),
        whirlpool: ctx.accounts.whirlpool.key(),
        token_vault_a: ctx.accounts.token_vault_a.key(),
        token_vault_b: ctx.accounts.token_vault_b.key(),
        fee_tier: ctx.accounts.fee_tier.key(),
        funder: ctx.accounts.creator.key(),
        token_program_a: ctx.accounts.token_program.key(),
        token_program_b: ctx.accounts.token_program.key(),
        system_program: ctx.accounts.system_program.key(),
        rent: ctx.accounts.rent.key(),
    };

    let ix_data = orca_ix::InitializePoolV2InstructionData {
        tick_spacing,
        initial_sqrt_price,
    };

    // Create the instruction
    let instruction = orca_ix::initialize_pool_v2(
        ctx.accounts.whirlpool_program.key(),
        ix.into(),
        ix_data,
    );

    // Execute CPI to Orca Whirlpool program
    // Note: Using invoke_signed with empty seeds (&[]) is equivalent to invoke()
    // If the Collection PDA needed to sign, you would pass PDA seeds here
    invoke_signed(
        &instruction,
        &[
            ctx.accounts.whirlpool_config.to_account_info(),
            ctx.accounts.collection_mint.to_account_info(),
            ctx.accounts.capgm_mint.to_account_info(),
            ctx.accounts.whirlpool.to_account_info(),
            ctx.accounts.token_vault_a.to_account_info(),
            ctx.accounts.token_vault_b.to_account_info(),
            ctx.accounts.fee_tier.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ],
        &[], // No PDA signer seeds needed for pool initialization
    )?;

    msg!("Orca Whirlpool initialized successfully!");
    
    Ok(())
}

#[derive(Accounts)]
pub struct OpenOrcaPosition<'info> {
    /// Position owner (creator)
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Collection state account
    #[account(
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump = collection.bump,
        constraint = collection.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    /// The whirlpool account
    /// CHECK: Validated against collection
    #[account(
        mut,
        constraint = whirlpool.key() == collection.pool_address @ ProtocolError::Unauthorized
    )]
    pub whirlpool: UncheckedAccount<'info>,

    /// Position account to be created
    /// CHECK: PDA derived from Orca program
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// Position mint (NFT representing the liquidity position)
    /// CHECK: Created by Orca program
    #[account(mut)]
    pub position_mint: UncheckedAccount<'info>,

    /// Position token account (holds the position NFT)
    /// CHECK: ATA for position mint
    #[account(mut)]
    pub position_token_account: UncheckedAccount<'info>,

    /// Position metadata account
    /// CHECK: Created by Orca program
    #[account(mut)]
    pub position_metadata: UncheckedAccount<'info>,

    /// CHECK: Orca Whirlpool program
    #[account(address = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    
    /// CHECK: Metaplex metadata program
    pub metadata_program: UncheckedAccount<'info>,
    
    /// CHECK: Metadata update authority
    pub metadata_update_auth: UncheckedAccount<'info>,
}

/// Open a liquidity position in the Orca Whirlpool using the official SDK
/// 
/// Creates a position NFT that represents ownership of liquidity in a specific price range.
/// 
/// ⚠️  IMPORTANT: 
/// - Calculate `tick_lower_index` and `tick_upper_index` CLIENT-SIDE using TickUtil.priceToTickIndex
/// - By default, the position NFT is owned by the `creator` (signer), NOT the protocol
/// - If the protocol should control liquidity, change `owner` to a PDA and add signer seeds
/// 
/// Parameters:
/// - tick_lower_index: The lower bound of the price range (calculate with TickUtil)
/// - tick_upper_index: The upper bound of the price range (calculate with TickUtil)
pub fn open_orca_position(
    ctx: Context<OpenOrcaPosition>,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    msg!("Opening Orca position using official SDK");
    msg!("Tick range: [{}, {}]", tick_lower_index, tick_upper_index);

    // Validate tick indices
    require!(
        tick_lower_index < tick_upper_index,
        ProtocolError::InvalidFeeConfig
    );

    // Build the open_position_with_metadata instruction using Orca SDK
    let ix = orca_ix::OpenPositionWithMetadata {
        whirlpool: ctx.accounts.whirlpool.key(),
        position: ctx.accounts.position.key(),
        position_mint: ctx.accounts.position_mint.key(),
        position_metadata_account: ctx.accounts.position_metadata.key(),
        position_token_account: ctx.accounts.position_token_account.key(),
        funder: ctx.accounts.creator.key(),
        owner: ctx.accounts.creator.key(), // ⚠️  User owns the position, not the protocol
        metadata_program: ctx.accounts.metadata_program.key(),
        metadata_update_auth: ctx.accounts.metadata_update_auth.key(),
        token_program: ctx.accounts.token_program.key(),
        system_program: ctx.accounts.system_program.key(),
        rent: ctx.accounts.rent.key(),
        associated_token_program: ctx.accounts.associated_token_program.key(),
    };

    let ix_data = orca_ix::OpenPositionWithMetadataInstructionData {
        tick_lower_index,
        tick_upper_index,
    };

    // Create the instruction
    let instruction = orca_ix::open_position_with_metadata(
        ctx.accounts.whirlpool_program.key(),
        ix.into(),
        ix_data,
    );

    // Execute CPI to Orca Whirlpool program
    invoke_signed(
        &instruction,
        &[
            ctx.accounts.whirlpool.to_account_info(),
            ctx.accounts.position.to_account_info(),
            ctx.accounts.position_mint.to_account_info(),
            ctx.accounts.position_metadata.to_account_info(),
            ctx.accounts.position_token_account.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.metadata_program.to_account_info(),
            ctx.accounts.metadata_update_auth.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
            ctx.accounts.associated_token_program.to_account_info(),
        ],
        &[], // If protocol PDA should own position, add signer seeds here
    )?;

    msg!("Position opened successfully: {}", ctx.accounts.position.key());
    
    Ok(())
}

#[derive(Accounts)]
pub struct DepositLiquidityToOrca<'info> {
    /// The creator (provides CAPGM/Quote tokens and pays for account creation)
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Collection PDA - The authority that owns the liquidity position
    /// This PDA will sign the Orca CPI to deposit liquidity
    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump = collection.bump,
        constraint = collection.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    /// The Orca Whirlpool
    /// CHECK: Validated by Orca program
    #[account(
        mut,
        constraint = whirlpool.key() == collection.pool_address @ ProtocolError::Unauthorized
    )]
    pub whirlpool: UncheckedAccount<'info>,

    /// The Position account (stores liquidity data)
    /// CHECK: Validated by Orca program
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// Position Token Account - Holds the position NFT
    /// ⚠️ CRITICAL: Must be owned by Collection PDA (not the user!)
    /// This ensures the protocol controls the liquidity, not individual users
    #[account(
        mut,
        constraint = position_token_account.owner == collection.key() @ ProtocolError::Unauthorized,
        constraint = position_token_account.mint == position_mint.key() @ ProtocolError::Unauthorized
    )]
    pub position_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// The Position Mint (NFT representing this liquidity position)
    /// CHECK: Validated by constraint on position_token_account
    pub position_mint: UncheckedAccount<'info>,

    // =========================================================================
    // TOKEN A (Collection Token)
    // =========================================================================
    
    /// Collection Token Mint
    #[account(
        constraint = token_mint_a.key() == collection.mint @ ProtocolError::Unauthorized
    )]
    pub token_mint_a: InterfaceAccount<'info, Mint>,

    /// Collection's Reserve for Token A
    /// Already funded by mint_collection_tokens() with 80% of supply
    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = collection,
    )]
    pub collection_reserve_a: InterfaceAccount<'info, TokenAccount>,

    // =========================================================================
    // TOKEN B (CAPGM / Quote Token) - "FLASH DEPOSIT" PATTERN
    // =========================================================================
    
    /// CAPGM Token Mint (the quote/base pair token)
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    /// Creator's Source Account for Token B (CAPGM)
    /// The user provides CAPGM tokens from here
    #[account(
        mut,
        constraint = creator_token_b.mint == token_mint_b.key() @ ProtocolError::Unauthorized,
        constraint = creator_token_b.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub creator_token_b: InterfaceAccount<'info, TokenAccount>,

    /// Collection's Reserve for Token B
    /// ⚠️ "FLASH DEPOSIT": We transfer CAPGM from creator → here first,
    /// then the Collection PDA (owning both reserves) signs the Orca CPI
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = token_mint_b,
        associated_token::authority = collection,
    )]
    pub collection_reserve_b: InterfaceAccount<'info, TokenAccount>,

    // =========================================================================
    // ORCA WHIRLPOOL ACCOUNTS
    // =========================================================================
    
    /// Whirlpool's token vault for Collection tokens
    /// CHECK: Managed by Orca program
    #[account(mut)]
    pub token_vault_a: UncheckedAccount<'info>,
    
    /// Whirlpool's token vault for CAPGM tokens
    /// CHECK: Managed by Orca program
    #[account(mut)]
    pub token_vault_b: UncheckedAccount<'info>,

    /// Tick array for lower bound
    /// CHECK: Managed by Orca program
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    
    /// Tick array for upper bound
    /// CHECK: Managed by Orca program
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Orca Whirlpool program
    #[account(address = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Deposit liquidity into an Orca Whirlpool using the "Flash Deposit" pattern
/// 
/// This instruction implements a sophisticated flow where the Collection PDA owns
/// and controls the liquidity, not individual users.
/// 
/// ## Flash Deposit Pattern
/// 
/// 1. **Pull**: Transfer CAPGM tokens from creator → Collection's reserve B
/// 2. **Deposit**: Collection PDA (owning both reserves A & B) signs Orca CPI
/// 3. **Complete**: Liquidity is deposited with Collection PDA as the position authority
/// 
/// This ensures:
/// - Protocol controls all liquidity (not bypassable by users)
/// - Position NFT is owned by Collection PDA
/// - Users cannot withdraw liquidity directly on Orca's frontend
/// 
/// ## Why Flash Deposit?
/// 
/// Orca requires that `position_authority` owns both token source accounts.
/// Since the Collection PDA must be the position authority (to control liquidity),
/// we must first transfer the user's CAPGM → Collection's reserve, then perform
/// the CPI with the Collection PDA signing.
/// 
/// This happens atomically in one transaction, so the user's tokens are never
/// at risk - either the entire flow succeeds or it all reverts.
/// 
/// ⚠️  IMPORTANT: All parameters must be calculated CLIENT-SIDE
/// 
/// Use the Orca SDK to calculate proper amounts based on:
/// - Current pool price
/// - Position's tick range
/// - Desired deposit amount in one token
/// 
/// Parameters:
/// - liquidity_amount: The amount of liquidity to add (in liquidity units, NOT token amounts)
/// - token_max_a: Maximum collection tokens willing to deposit (slippage protection)
/// - token_max_b: Maximum CAPGM tokens willing to deposit (slippage protection)
pub fn deposit_liquidity_to_orca(
    ctx: Context<DepositLiquidityToOrca>,
    liquidity_amount: u128,
    token_max_a: u64,
    token_max_b: u64,
) -> Result<()> {
    msg!("=== Starting Flash Deposit to Orca ===");
    msg!("Liquidity amount: {}", liquidity_amount);
    msg!("Max token A (Collection): {}", token_max_a);
    msg!("Max token B (CAPGM): {}", token_max_b);

    // Validate amounts
    require!(
        liquidity_amount > 0 && token_max_a > 0 && token_max_b > 0,
        ProtocolError::InvalidFeeConfig
    );

    // =========================================================================
    // STEP 1: PULL - Transfer CAPGM from Creator → Collection Reserve B
    // =========================================================================
    
    msg!("Step 1: Pulling {} CAPGM tokens to Collection Reserve B...", token_max_b);
    
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.creator_token_b.to_account_info(),
        mint: ctx.accounts.token_mint_b.to_account_info(),
        to: ctx.accounts.collection_reserve_b.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts
    );
    
    anchor_spl::token_interface::transfer_checked(
        transfer_ctx,
        token_max_b,
        ctx.accounts.token_mint_b.decimals
    )?;

    msg!("✓ CAPGM tokens transferred to Collection Reserve B");

    // =========================================================================
    // STEP 2: DEPOSIT - Collection PDA signs Orca CPI
    // =========================================================================
    
    msg!("Step 2: Preparing Orca CPI with Collection PDA as authority...");
    
    // Prepare PDA signer seeds
    let collection = &ctx.accounts.collection;
    let bump = collection.bump;
    let seeds = &[
        b"collection",
        collection.owner.as_ref(),
        collection.collection_id.as_bytes(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Build the Orca increase_liquidity_v2 instruction
    // CRITICAL: position_authority = Collection PDA (owns the position)
    let ix = orca_ix::IncreaseLiquidityV2 {
        whirlpool: ctx.accounts.whirlpool.key(),
        position: ctx.accounts.position.key(),
        position_token_account: ctx.accounts.position_token_account.key(),
        position_authority: ctx.accounts.collection.key(), // ✅ Collection PDA signs
        token_owner_account_a: ctx.accounts.collection_reserve_a.key(), // ✅ 80% from minting
        token_owner_account_b: ctx.accounts.collection_reserve_b.key(), // ✅ Just transferred
        token_vault_a: ctx.accounts.token_vault_a.key(),
        token_vault_b: ctx.accounts.token_vault_b.key(),
        tick_array_lower: ctx.accounts.tick_array_lower.key(),
        tick_array_upper: ctx.accounts.tick_array_upper.key(),
        token_program_a: ctx.accounts.token_program.key(),
        token_program_b: ctx.accounts.token_program.key(),
        memo_program: ctx.accounts.system_program.key(), // Use system as dummy if no memo
    };

    let ix_data = orca_ix::IncreaseLiquidityV2InstructionData {
        liquidity_amount,
        token_max_a,
        token_max_b,
        remaining_accounts_info: None, // For transfer hooks if needed
    };

    let instruction = orca_ix::increase_liquidity_v2(
        ctx.accounts.whirlpool_program.key(),
        ix.into(),
        ix_data,
    );

    msg!("Step 3: Executing Orca CPI with Collection PDA signature...");

    // Execute CPI to Orca Whirlpool program
    // The Collection PDA signs, authorizing the transfer from both reserves
    invoke_signed(
        &instruction,
        &[
            ctx.accounts.whirlpool.to_account_info(),
            ctx.accounts.position.to_account_info(),
            ctx.accounts.position_token_account.to_account_info(),
            ctx.accounts.collection.to_account_info(), // ✅ PDA Signer
            ctx.accounts.collection_reserve_a.to_account_info(), // ✅ Collection tokens
            ctx.accounts.collection_reserve_b.to_account_info(), // ✅ CAPGM tokens
            ctx.accounts.token_vault_a.to_account_info(),
            ctx.accounts.token_vault_b.to_account_info(),
            ctx.accounts.tick_array_lower.to_account_info(),
            ctx.accounts.tick_array_upper.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer_seeds, // ✅ Collection PDA signs the CPI
    )?;

    msg!("=== Flash Deposit Complete! ===");
    msg!("✓ Liquidity deposited to Orca Whirlpool");
    msg!("✓ Position owned by Collection PDA: {}", collection.key());
    msg!("✓ Collection Reserve A: {}", ctx.accounts.collection_reserve_a.key());
    msg!("✓ Collection Reserve B: {}", ctx.accounts.collection_reserve_b.key());
    
    Ok(())
}

// ============================================================================
// IMPORTANT: Price and Tick Calculations Should Be Done CLIENT-SIDE
// ============================================================================
//
// ⚠️  DO NOT perform floating-point math (f64, ln(), pow(), etc.) on-chain!
//
// Reasons:
// 1. High Compute Unit (CU) cost on Solana runtime
// 2. Potential non-deterministic behavior across validators
// 3. Precision loss in floating-point operations
//
// ✅  Instead, calculate these values in your TypeScript/JavaScript client:
//
// Example using @orca-so/whirlpools-sdk:
//
// ```typescript
// import { PriceMath, TickUtil } from "@orca-so/whirlpools-sdk";
//
// // Calculate sqrt price from regular price
// const price = 0.01; // 1 Collection Token = 0.01 CAPGM
// const sqrtPriceX64 = PriceMath.priceToSqrtPriceX64(price, decimalsA, decimalsB);
//
// // Calculate tick index from price
// const tickIndex = TickUtil.priceToTickIndex(price, decimalsA, decimalsB);
//
// // Pass these pre-calculated values to your instruction
// await program.methods
//   .initializeOrcaPool(tickSpacing, sqrtPriceX64)
//   .accounts({ ... })
//   .rpc();
// ```
//
// For PDA derivation:
// ```typescript
// import { PDAUtil } from "@orca-so/whirlpools-sdk";
//
// const whirlpoolPda = PDAUtil.getWhirlpool(
//   ORCA_WHIRLPOOL_PROGRAM_ID,
//   whirlpoolsConfigKey,
//   tokenMintA,
//   tokenMintB,
//   tickSpacing
// );
// ```
// ============================================================================
