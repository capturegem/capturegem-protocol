use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::ProtocolError;

// Import Orca Whirlpool client SDK
// This provides CPI-ready instructions and account structures
use orca_whirlpools_client::instructions as orca_ix;
use orca_whirlpools_client::accounts as orca_accounts;
use orca_whirlpools_core::{sqrt_price_to_price, price_to_sqrt_price};

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
/// Parameters:
/// - tick_spacing: Determines price granularity (1, 64, or 128)
/// - initial_sqrt_price: Initial price in Q64.64 format
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
/// Parameters:
/// - tick_lower_index: The lower bound of the price range
/// - tick_upper_index: The upper bound of the price range
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
        owner: ctx.accounts.creator.key(),
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
        &[], // No PDA signer seeds needed
    )?;

    msg!("Position opened successfully: {}", ctx.accounts.position.key());
    
    Ok(())
}

#[derive(Accounts)]
pub struct DepositLiquidityToOrca<'info> {
    /// Liquidity provider (creator or protocol PDA)
    #[account(mut)]
    pub liquidity_provider: Signer<'info>,

    /// Collection state account
    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump = collection.bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// The whirlpool account
    /// CHECK: Validated against collection
    #[account(
        mut,
        constraint = whirlpool.key() == collection.pool_address @ ProtocolError::Unauthorized
    )]
    pub whirlpool: UncheckedAccount<'info>,

    /// Position account
    /// CHECK: Validated by Orca program
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// Position token account (proves ownership of position)
    /// CHECK: ATA holding the position NFT
    #[account(
        constraint = position_token_account.owner == liquidity_provider.key()
    )]
    pub position_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Source token account for collection tokens
    #[account(
        mut,
        constraint = token_owner_account_a.mint == collection.mint @ ProtocolError::Unauthorized
    )]
    pub token_owner_account_a: InterfaceAccount<'info, TokenAccount>,

    /// Source token account for CAPGM tokens
    #[account(mut)]
    pub token_owner_account_b: InterfaceAccount<'info, TokenAccount>,

    /// Whirlpool's token vault for collection tokens
    /// CHECK: Managed by Orca program
    #[account(mut)]
    pub token_vault_a: UncheckedAccount<'info>,

    /// Whirlpool's token vault for CAPGM tokens
    /// CHECK: Managed by Orca program
    #[account(mut)]
    pub token_vault_b: UncheckedAccount<'info>,

    /// Tick array for lower bound
    /// CHECK: Validated by Orca program
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,

    /// Tick array for upper bound
    /// CHECK: Validated by Orca program
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Orca Whirlpool program
    #[account(address = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Deposit liquidity into an existing Orca position using the official SDK
/// 
/// Parameters:
/// - liquidity_amount: The amount of liquidity to add (in liquidity units)
/// - token_max_a: Maximum collection tokens willing to deposit
/// - token_max_b: Maximum CAPGM tokens willing to deposit
pub fn deposit_liquidity_to_orca(
    ctx: Context<DepositLiquidityToOrca>,
    liquidity_amount: u128,
    token_max_a: u64,
    token_max_b: u64,
) -> Result<()> {
    msg!("Depositing liquidity to Orca using official SDK");
    msg!("Liquidity amount: {}", liquidity_amount);
    msg!("Max token A: {}", token_max_a);
    msg!("Max token B: {}", token_max_b);

    // Validate amounts
    require!(
        liquidity_amount > 0 && token_max_a > 0 && token_max_b > 0,
        ProtocolError::InvalidFeeConfig
    );

    // Build the increase_liquidity_v2 instruction using Orca SDK
    let ix = orca_ix::IncreaseLiquidityV2 {
        whirlpool: ctx.accounts.whirlpool.key(),
        position: ctx.accounts.position.key(),
        position_token_account: ctx.accounts.position_token_account.key(),
        position_authority: ctx.accounts.liquidity_provider.key(),
        token_owner_account_a: ctx.accounts.token_owner_account_a.key(),
        token_owner_account_b: ctx.accounts.token_owner_account_b.key(),
        token_vault_a: ctx.accounts.token_vault_a.key(),
        token_vault_b: ctx.accounts.token_vault_b.key(),
        tick_array_lower: ctx.accounts.tick_array_lower.key(),
        tick_array_upper: ctx.accounts.tick_array_upper.key(),
        token_program_a: ctx.accounts.token_program.key(),
        token_program_b: ctx.accounts.token_program.key(),
        memo_program: solana_program::system_program::ID, // Optional memo program
    };

    let ix_data = orca_ix::IncreaseLiquidityV2InstructionData {
        liquidity_amount,
        token_max_a,
        token_max_b,
        remaining_accounts_info: None, // For transfer hooks if needed
    };

    // Create the instruction
    let instruction = orca_ix::increase_liquidity_v2(
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
            ctx.accounts.position_token_account.to_account_info(),
            ctx.accounts.liquidity_provider.to_account_info(),
            ctx.accounts.token_owner_account_a.to_account_info(),
            ctx.accounts.token_owner_account_b.to_account_info(),
            ctx.accounts.token_vault_a.to_account_info(),
            ctx.accounts.token_vault_b.to_account_info(),
            ctx.accounts.tick_array_lower.to_account_info(),
            ctx.accounts.tick_array_upper.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        &[], // If using PDA, add signer seeds here
    )?;

    msg!("Liquidity deposited successfully!");
    
    Ok(())
}

/// Helper function to calculate sqrt price from regular price using Orca SDK
/// 
/// Uses the official Orca core library for accurate price calculations.
/// 
/// Example: If 1 Collection Token = 0.01 CAPGM:
/// ```
/// let sqrt_price_x64 = calculate_sqrt_price_x64(0.01, 6, 6);
/// ```
pub fn calculate_sqrt_price_x64(
    price: f64,
    decimals_a: u8,
    decimals_b: u8,
) -> u128 {
    // Use Orca's price_to_sqrt_price function for accurate conversion
    price_to_sqrt_price(price, decimals_a, decimals_b)
}

/// Helper function to convert sqrt price back to regular price using Orca SDK
pub fn calculate_price_from_sqrt(
    sqrt_price_x64: u128,
    decimals_a: u8,
    decimals_b: u8,
) -> f64 {
    // Use Orca's sqrt_price_to_price function
    sqrt_price_to_price(sqrt_price_x64, decimals_a, decimals_b)
}

/// Helper to calculate the tick index for a given price
/// 
/// Note: For precise tick calculations, use Orca's core library functions
pub fn price_to_tick_index(price: f64) -> i32 {
    // Tick index = log_{1.0001}(price)
    let log_price = price.ln();
    let log_base = 1.0001_f64.ln();
    (log_price / log_base).floor() as i32
}

/// Helper to calculate price from tick index
pub fn tick_index_to_price(tick_index: i32) -> f64 {
    // Price = 1.0001^tick_index
    1.0001_f64.powi(tick_index)
}
