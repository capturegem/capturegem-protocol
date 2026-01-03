use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::ProtocolError;

/// Orca Whirlpool Program ID (Mainnet/Devnet)
pub const ORCA_WHIRLPOOL_PROGRAM_ID: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

// ============================================================================
// ORCA INSTRUCTION DISCRIMINATORS
// These are the 8-byte discriminators for Orca Whirlpool instructions
// ============================================================================

/// Discriminator for initialize_pool_v2 instruction
const INITIALIZE_POOL_V2_DISCRIMINATOR: [u8; 8] = [207, 45, 87, 242, 27, 63, 204, 67];

/// Discriminator for open_position_with_metadata instruction  
const OPEN_POSITION_WITH_METADATA_DISCRIMINATOR: [u8; 8] = [242, 16, 12, 155, 61, 101, 151, 133];

/// Discriminator for increase_liquidity_v2 instruction
const INCREASE_LIQUIDITY_V2_DISCRIMINATOR: [u8; 8] = [133, 29, 89, 223, 69, 238, 176, 10];

// ============================================================================
// ACCOUNT STRUCTURES
// ============================================================================

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

    /// Token badge A (for token extensions)
    /// CHECK: Validated by Orca program
    pub token_badge_a: UncheckedAccount<'info>,

    /// Token badge B (for token extensions)
    /// CHECK: Validated by Orca program
    pub token_badge_b: UncheckedAccount<'info>,

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
pub fn initialize_orca_pool(
    ctx: Context<InitializeOrcaPool>,
    tick_spacing: u16,
    initial_sqrt_price: u128,
) -> Result<()> {
    msg!("Initializing Orca Whirlpool");
    msg!("Collection: {}", ctx.accounts.collection.collection_id);
    msg!("Pool: {}", ctx.accounts.whirlpool.key());
    msg!("Tick Spacing: {}", tick_spacing);
    msg!("Initial Sqrt Price: {}", initial_sqrt_price);

    // Build instruction data
    let mut data = Vec::with_capacity(8 + 2 + 16);
    data.extend_from_slice(&INITIALIZE_POOL_V2_DISCRIMINATOR);
    data.extend_from_slice(&tick_spacing.to_le_bytes());
    data.extend_from_slice(&initial_sqrt_price.to_le_bytes());

    // Build account metas
    let accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.whirlpool_config.key(), false),
        AccountMeta::new_readonly(ctx.accounts.collection_mint.key(), false),
        AccountMeta::new_readonly(ctx.accounts.capgm_mint.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_badge_a.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_badge_b.key(), false),
        AccountMeta::new(ctx.accounts.creator.key(), true), // funder
        AccountMeta::new(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_a.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_b.key(), false),
        AccountMeta::new_readonly(ctx.accounts.fee_tier.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false), // token_program_b
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
    ];

    let instruction = Instruction {
        program_id: ORCA_WHIRLPOOL_PROGRAM_ID,
        accounts,
        data,
    };

    invoke_signed(
        &instruction,
        &[
            ctx.accounts.whirlpool_config.to_account_info(),
            ctx.accounts.collection_mint.to_account_info(),
            ctx.accounts.capgm_mint.to_account_info(),
            ctx.accounts.token_badge_a.to_account_info(),
            ctx.accounts.token_badge_b.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.whirlpool.to_account_info(),
            ctx.accounts.token_vault_a.to_account_info(),
            ctx.accounts.token_vault_b.to_account_info(),
            ctx.accounts.fee_tier.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ],
        &[],
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

/// Open a liquidity position in the Orca Whirlpool
pub fn open_orca_position(
    ctx: Context<OpenOrcaPosition>,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    msg!("Opening Orca position (Collection PDA will own the NFT)");
    msg!("Tick range: [{}, {}]", tick_lower_index, tick_upper_index);
    msg!("Position NFT owner: {}", ctx.accounts.collection.key());

    require!(
        tick_lower_index < tick_upper_index,
        ProtocolError::InvalidFeeConfig
    );

    // Build instruction data
    // Format: discriminator + bump (u8) + tick_lower_index (i32) + tick_upper_index (i32)
    let mut data = Vec::with_capacity(8 + 1 + 4 + 4);
    data.extend_from_slice(&OPEN_POSITION_WITH_METADATA_DISCRIMINATOR);
    data.push(0u8); // bump placeholder - Orca will calculate
    data.extend_from_slice(&tick_lower_index.to_le_bytes());
    data.extend_from_slice(&tick_upper_index.to_le_bytes());

    // Build account metas
    let accounts = vec![
        AccountMeta::new(ctx.accounts.creator.key(), true), // funder
        AccountMeta::new_readonly(ctx.accounts.collection.key(), false), // owner (Collection PDA)
        AccountMeta::new(ctx.accounts.position.key(), false),
        AccountMeta::new(ctx.accounts.position_mint.key(), true),
        AccountMeta::new(ctx.accounts.position_metadata.key(), false),
        AccountMeta::new(ctx.accounts.position_token_account.key(), false),
        AccountMeta::new_readonly(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
        AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.metadata_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.metadata_update_auth.key(), false),
    ];

    let instruction = Instruction {
        program_id: ORCA_WHIRLPOOL_PROGRAM_ID,
        accounts,
        data,
    };

    invoke_signed(
        &instruction,
        &[
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.position.to_account_info(),
            ctx.accounts.position_mint.to_account_info(),
            ctx.accounts.position_metadata.to_account_info(),
            ctx.accounts.position_token_account.to_account_info(),
            ctx.accounts.whirlpool.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
            ctx.accounts.associated_token_program.to_account_info(),
            ctx.accounts.metadata_program.to_account_info(),
            ctx.accounts.metadata_update_auth.to_account_info(),
        ],
        &[],
    )?;

    msg!("Position opened successfully!");
    msg!("   Position: {}", ctx.accounts.position.key());
    msg!("   NFT Owner: {} (Collection PDA)", ctx.accounts.collection.key());
    
    Ok(())
}

#[derive(Accounts)]
pub struct DepositLiquidityToOrca<'info> {
    /// The creator (provides CAPGM/Quote tokens and pays for account creation)
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Collection PDA - The authority that owns the liquidity position
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
    #[account(
        mut,
        constraint = position_token_account.owner == collection.key() @ ProtocolError::Unauthorized,
        constraint = position_token_account.mint == position_mint.key() @ ProtocolError::Unauthorized
    )]
    pub position_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// The Position Mint (NFT representing this liquidity position)
    /// CHECK: Validated by constraint on position_token_account
    pub position_mint: UncheckedAccount<'info>,

    /// Collection Token Mint
    #[account(
        constraint = token_mint_a.key() == collection.mint @ ProtocolError::Unauthorized
    )]
    pub token_mint_a: InterfaceAccount<'info, Mint>,

    /// Collection's Reserve for Token A
    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = collection,
    )]
    pub collection_reserve_a: InterfaceAccount<'info, TokenAccount>,

    /// CAPGM Token Mint (the quote/base pair token)
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    /// Creator's Source Account for Token B (CAPGM)
    #[account(
        mut,
        constraint = creator_token_b.mint == token_mint_b.key() @ ProtocolError::Unauthorized,
        constraint = creator_token_b.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub creator_token_b: InterfaceAccount<'info, TokenAccount>,

    /// Collection's Reserve for Token B
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = token_mint_b,
        associated_token::authority = collection,
    )]
    pub collection_reserve_b: InterfaceAccount<'info, TokenAccount>,

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

    require!(
        liquidity_amount > 0 && token_max_a > 0 && token_max_b > 0,
        ProtocolError::InvalidFeeConfig
    );

    // STEP 1: Transfer CAPGM from Creator → Collection Reserve B
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

    msg!("CAPGM tokens transferred to Collection Reserve B");

    // STEP 2: Build and execute Orca CPI
    msg!("Step 2: Preparing Orca CPI with Collection PDA as authority...");
    
    let collection = &ctx.accounts.collection;
    let bump = collection.bump;
    let seeds = &[
        b"collection",
        collection.owner.as_ref(),
        collection.collection_id.as_bytes(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Build instruction data
    let mut data = Vec::with_capacity(8 + 16 + 8 + 8 + 1);
    data.extend_from_slice(&INCREASE_LIQUIDITY_V2_DISCRIMINATOR);
    data.extend_from_slice(&liquidity_amount.to_le_bytes());
    data.extend_from_slice(&token_max_a.to_le_bytes());
    data.extend_from_slice(&token_max_b.to_le_bytes());
    data.push(0u8); // remaining_accounts_info: None (encoded as Option::None)

    // Build account metas
    let accounts = vec![
        AccountMeta::new(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false), // token_program_a
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false), // token_program_b
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false), // memo_program (dummy)
        AccountMeta::new_readonly(ctx.accounts.collection.key(), true), // position_authority (signer)
        AccountMeta::new(ctx.accounts.position.key(), false),
        AccountMeta::new_readonly(ctx.accounts.position_token_account.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_mint_a.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_mint_b.key(), false),
        AccountMeta::new(ctx.accounts.collection_reserve_a.key(), false), // token_owner_account_a
        AccountMeta::new(ctx.accounts.collection_reserve_b.key(), false), // token_owner_account_b
        AccountMeta::new(ctx.accounts.token_vault_a.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_b.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_lower.key(), false),
        AccountMeta::new(ctx.accounts.tick_array_upper.key(), false),
    ];

    let instruction = Instruction {
        program_id: ORCA_WHIRLPOOL_PROGRAM_ID,
        accounts,
        data,
    };

    msg!("Step 3: Executing Orca CPI with Collection PDA signature...");

    invoke_signed(
        &instruction,
        &[
            ctx.accounts.whirlpool.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.collection.to_account_info(),
            ctx.accounts.position.to_account_info(),
            ctx.accounts.position_token_account.to_account_info(),
            ctx.accounts.token_mint_a.to_account_info(),
            ctx.accounts.token_mint_b.to_account_info(),
            ctx.accounts.collection_reserve_a.to_account_info(),
            ctx.accounts.collection_reserve_b.to_account_info(),
            ctx.accounts.token_vault_a.to_account_info(),
            ctx.accounts.token_vault_b.to_account_info(),
            ctx.accounts.tick_array_lower.to_account_info(),
            ctx.accounts.tick_array_upper.to_account_info(),
        ],
        signer_seeds,
    )?;

    msg!("=== Flash Deposit Complete! ===");
    msg!("Liquidity deposited to Orca Whirlpool");
    msg!("Position owned by Collection PDA: {}", collection.key());
    
    Ok(())
}
