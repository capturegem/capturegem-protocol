use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

/// Orca Whirlpool Program ID
/// NOTE: This program ID is the same on both Mainnet and Devnet
/// Address: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
pub const ORCA_WHIRLPOOL_PROGRAM_ID: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

// ============================================================================
// ORCA INSTRUCTION DISCRIMINATORS
// ============================================================================

/// Discriminator for initialize_pool_v2 instruction
const INITIALIZE_POOL_V2_DISCRIMINATOR: [u8; 8] = [207, 45, 87, 242, 27, 63, 204, 67];

/// Discriminator for open_position_with_metadata instruction  
const OPEN_POSITION_WITH_METADATA_DISCRIMINATOR: [u8; 8] = [242, 16, 12, 155, 61, 101, 151, 133];

/// Discriminator for increase_liquidity_v2 instruction
const INCREASE_LIQUIDITY_V2_DISCRIMINATOR: [u8; 8] = [133, 29, 89, 223, 69, 238, 176, 10];

// ============================================================================
// HELPER STRUCTS FOR SERIALIZATION
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct IncreaseLiquidityV2Params {
    pub liquidity_amount: u128,
    pub token_max_a: u64,
    pub token_max_b: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct OpenPositionParams {
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
}

// ============================================================================
// INSTRUCTIONS
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

    /// Whirlpool config account
    /// CHECK: Validated by Orca program
    #[account(owner = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_config: UncheckedAccount<'info>,

    /// Token badge A
    /// CHECK: Validated by Orca program
    pub token_badge_a: UncheckedAccount<'info>,

    /// Token badge B
    /// CHECK: Validated by Orca program
    pub token_badge_b: UncheckedAccount<'info>,

    /// The whirlpool account to be initialized
    /// CHECK: PDA derived from Orca program, validated by Orca
    #[account(
        mut,
        constraint = whirlpool.key() == collection.pool_address @ ProtocolError::Unauthorized
    )]
    pub whirlpool: UncheckedAccount<'info>,

    /// Token vault A
    /// CHECK: Created and managed by Orca program
    #[account(mut)]
    pub token_vault_a: UncheckedAccount<'info>,

    /// Token vault B
    /// CHECK: Created and managed by Orca program
    #[account(mut)]
    pub token_vault_b: UncheckedAccount<'info>,

    /// Fee tier configuration
    /// CHECK: Validated by Orca program
    #[account(owner = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub fee_tier: UncheckedAccount<'info>,

    /// CHECK: Orca Whirlpool program (validated by address constraint)
    #[account(address = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_orca_pool(
    ctx: Context<InitializeOrcaPool>,
    tick_spacing: u16,
    initial_sqrt_price: u128,
) -> Result<()> {
    msg!("Initializing Orca Whirlpool");
    msg!("Tick Spacing: {}", tick_spacing);

    // Basic validation for standard Orca tick spacings
    require!(
        [1, 8, 64, 128].contains(&tick_spacing),
        ProtocolError::InvalidFeeConfig
    );

    // Build instruction data
    let mut data = Vec::with_capacity(8 + 2 + 16);
    data.extend_from_slice(&INITIALIZE_POOL_V2_DISCRIMINATOR);
    data.extend_from_slice(&tick_spacing.to_le_bytes());
    data.extend_from_slice(&initial_sqrt_price.to_le_bytes());

    let accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.whirlpool_config.key(), false),
        AccountMeta::new_readonly(ctx.accounts.collection_mint.key(), false),
        AccountMeta::new_readonly(ctx.accounts.capgm_mint.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_badge_a.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_badge_b.key(), false),
        AccountMeta::new(ctx.accounts.creator.key(), true),
        AccountMeta::new(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_a.key(), false),
        AccountMeta::new(ctx.accounts.token_vault_b.key(), false),
        AccountMeta::new_readonly(ctx.accounts.fee_tier.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false), // token_program_b same as a
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
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump = collection.bump,
        constraint = collection.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: Validated against collection
    #[account(
        mut,
        constraint = whirlpool.key() == collection.pool_address @ ProtocolError::Unauthorized,
        owner = ORCA_WHIRLPOOL_PROGRAM_ID
    )]
    pub whirlpool: UncheckedAccount<'info>,

    /// CHECK: PDA derived from Orca program
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    /// CHECK: Created by Orca program
    #[account(mut)]
    pub position_mint: UncheckedAccount<'info>,

    /// CHECK: ATA for position mint
    #[account(mut)]
    pub position_token_account: UncheckedAccount<'info>,

    /// CHECK: Created by Orca program
    #[account(mut)]
    pub position_metadata: UncheckedAccount<'info>,

    /// CHECK: Orca Whirlpool program (validated by address constraint)
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

pub fn open_orca_position(
    ctx: Context<OpenOrcaPosition>,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    msg!("Opening Orca position (Collection PDA will own the NFT)");
    
    require!(
        tick_lower_index < tick_upper_index,
        ProtocolError::InvalidFeeConfig
    );

    let params = OpenPositionParams {
        tick_lower_index,
        tick_upper_index,
    };

    // Serialize data: Discriminator + Bump (0) + Params
    let mut data = Vec::with_capacity(8 + 1 + 8);
    data.extend_from_slice(&OPEN_POSITION_WITH_METADATA_DISCRIMINATOR);
    data.push(0u8); // bump placeholder
    data.extend_from_slice(&params.try_to_vec()?);

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
    Ok(())
}

#[derive(Accounts)]
pub struct DepositLiquidityToOrca<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump = collection.bump,
        constraint = collection.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: Validated by Orca program
    #[account(
        mut,
        constraint = whirlpool.key() == collection.pool_address @ ProtocolError::Unauthorized,
        owner = ORCA_WHIRLPOOL_PROGRAM_ID
    )]
    pub whirlpool: UncheckedAccount<'info>,

    /// CHECK: Validated by Orca program
    #[account(mut, owner = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub position: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = position_token_account.owner == collection.key() @ ProtocolError::Unauthorized,
        constraint = position_token_account.mint == position_mint.key() @ ProtocolError::Unauthorized
    )]
    pub position_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: Validated by constraint on position_token_account
    pub position_mint: UncheckedAccount<'info>,

    #[account(
        constraint = token_mint_a.key() == collection.mint @ ProtocolError::Unauthorized
    )]
    pub token_mint_a: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint_a,
        associated_token::authority = collection,
    )]
    pub collection_reserve_a: InterfaceAccount<'info, TokenAccount>,

    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = creator_token_b.mint == token_mint_b.key() @ ProtocolError::Unauthorized,
        constraint = creator_token_b.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub creator_token_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = token_mint_b,
        associated_token::authority = collection,
    )]
    pub collection_reserve_b: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Managed by Orca program
    #[account(mut)]
    pub token_vault_a: UncheckedAccount<'info>,
    
    /// CHECK: Managed by Orca program
    #[account(mut)]
    pub token_vault_b: UncheckedAccount<'info>,

    /// Tick array for lower bound
    /// CHECK: Managed by Orca program
    #[account(mut, owner = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub tick_array_lower: UncheckedAccount<'info>,
    
    /// Tick array for upper bound
    /// CHECK: Managed by Orca program
    #[account(mut, owner = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Orca Whirlpool program (validated by address constraint)
    #[account(address = ORCA_WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn deposit_liquidity_to_orca(
    ctx: Context<DepositLiquidityToOrca>,
    liquidity_amount: u128,
    token_max_a: u64,
    token_max_b: u64,
) -> Result<()> {
    msg!("=== Starting Flash Deposit to Orca ===");

    require!(
        liquidity_amount > 0 && token_max_a > 0 && token_max_b > 0,
        ProtocolError::InvalidFeeConfig
    );

    require!(
        token_max_b >= MIN_INITIAL_CAPGM_LIQUIDITY,
        ProtocolError::InsufficientInitialLiquidity
    );

    // STEP 1: Transfer CAPGM from Creator -> Collection Reserve B
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

    // Get balance after transfer (before Orca call)
    // This represents the total amount available for Orca to use
    let balance_after_transfer = ctx.accounts.collection_reserve_b.amount;

    // STEP 2: Execute Orca CPI
    msg!("Step 2: Preparing Orca CPI...");
    
    let collection = &ctx.accounts.collection;
    let bump = collection.bump;
    let seeds = &[
        b"collection",
        collection.owner.as_ref(),
        collection.collection_id.as_bytes(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Serialize parameters safely
    let params = IncreaseLiquidityV2Params {
        liquidity_amount,
        token_max_a,
        token_max_b,
    };

    let mut data = Vec::with_capacity(8 + 32);
    data.extend_from_slice(&INCREASE_LIQUIDITY_V2_DISCRIMINATOR);
    data.extend_from_slice(&params.try_to_vec()?);
    
    // IMPORTANT: V2 instructions typically expect `Option<RemainingAccountsInfo>`.
    // Since we aren't using remaining accounts, we pass None (0u8).
    data.push(0u8); 

    let accounts = vec![
        AccountMeta::new(ctx.accounts.whirlpool.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.collection.key(), true), // signer
        AccountMeta::new(ctx.accounts.position.key(), false),
        AccountMeta::new_readonly(ctx.accounts.position_token_account.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_mint_a.key(), false),
        AccountMeta::new_readonly(ctx.accounts.token_mint_b.key(), false),
        AccountMeta::new(ctx.accounts.collection_reserve_a.key(), false),
        AccountMeta::new(ctx.accounts.collection_reserve_b.key(), false),
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

    // STEP 3: Refund unused token B back to creator
    // Reload the account to get updated balance after Orca call
    ctx.accounts.collection_reserve_b.reload()?;
    let balance_after_orca = ctx.accounts.collection_reserve_b.amount;
    
    // Calculate how much was actually used by Orca
    // This is the difference between balance after transfer and balance after Orca
    let actual_used = balance_after_transfer
        .checked_sub(balance_after_orca)
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Calculate refund amount: token_max_b - actual_used
    // This refunds any excess that wasn't needed due to pool price
    // Note: If there was a previous balance in collection_reserve_b, we only refund
    // the excess from the token_max_b we just transferred, not from the previous balance
    let refund_amount = token_max_b
        .checked_sub(actual_used)
        .ok_or(ProtocolError::MathOverflow)?;
    
    if refund_amount > 0 {
        msg!("Refunding unused token B: {} (provided: {}, used: {})", 
             refund_amount, token_max_b, actual_used);
        
        // Transfer refund from collection_reserve_b back to creator
        let refund_accounts = TransferChecked {
            from: ctx.accounts.collection_reserve_b.to_account_info(),
            mint: ctx.accounts.token_mint_b.to_account_info(),
            to: ctx.accounts.creator_token_b.to_account_info(),
            authority: ctx.accounts.collection.to_account_info(),
        };
        
        let refund_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            refund_accounts,
            signer_seeds,
        );
        
        anchor_spl::token_interface::transfer_checked(
            refund_ctx,
            refund_amount,
            ctx.accounts.token_mint_b.decimals
        )?;
        
        msg!("Refund complete: {} tokens returned to creator", refund_amount);
    } else {
        msg!("No refund needed: all {} tokens were used", token_max_b);
    }

    msg!("=== Flash Deposit Complete! ===");
    Ok(())
}