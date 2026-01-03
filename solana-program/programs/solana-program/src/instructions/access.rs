use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_interface::{TokenInterface, TransferChecked, Burn, burn, Mint, TokenAccount, MintTo, mint_to};
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::associated_token::AssociatedToken;
use spl_token_2022::extension::{ExtensionType, StateWithExtensionsMut, BaseStateWithExtensionsMut};
use spl_token_2022::state::Mint as MintState;
use spl_token_2022::instruction::{transfer_checked as spl_transfer_checked, set_authority};
use spl_token_2022::instruction::AuthorityType;
use mpl_token_metadata::{
    instructions::create_metadata_accounts_v3,
    types::DataV2,
    ID as METADATA_PROGRAM_ID,
};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct EscrowReleasedEvent {
    pub purchaser: Pubkey,
    pub collection: Pubkey,
    pub total_amount: u64,
    pub peer_wallets: Vec<Pubkey>,
    pub peer_weights: Vec<u64>,
    pub timestamp: i64,
}

// ============================================================================
// Purchase Access - Creates escrow with 50/50 split
// ============================================================================

#[derive(Accounts)]
pub struct PurchaseAccess<'info> {
    #[account(mut)]
    pub purchaser: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// Staking pool for this collection - receives 50% of purchase
    #[account(
        mut,
        seeds = [SEED_STAKING_POOL, collection.key().as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, CollectionStakingPool>,

    /// Purchaser's collection token account (source of purchased tokens)
    #[account(
        mut,
        constraint = purchaser_token_account.owner == purchaser.key() @ ProtocolError::Unauthorized,
        constraint = purchaser_token_account.mint == collection_mint.key() @ ProtocolError::Unauthorized
    )]
    pub purchaser_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Staking pool's collection token account (receives 50%)
    /// Must be owned by the staking pool PDA and use the collection mint
    #[account(
        mut,
        constraint = pool_token_account.owner == staking_pool.key() @ ProtocolError::Unauthorized,
        constraint = pool_token_account.mint == collection_mint.key() @ ProtocolError::Unauthorized
    )]
    pub pool_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Access Escrow token account (PDA) that will hold the locked tokens (50%)
    /// Must be owned by the access escrow PDA and use the collection mint
    #[account(
        mut,
        constraint = escrow_token_account.owner == access_escrow.key() @ ProtocolError::Unauthorized,
        constraint = escrow_token_account.mint == collection_mint.key() @ ProtocolError::Unauthorized
    )]
    pub escrow_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Access Escrow PDA - will be created
    #[account(
        init,
        payer = purchaser,
        space = AccessEscrow::MAX_SIZE,
        seeds = [SEED_ACCESS_ESCROW, purchaser.key().as_ref(), collection.key().as_ref()],
        bump
    )]
    pub access_escrow: Account<'info, AccessEscrow>,

    /// Access NFT Mint - will be created with Non-Transferable extension
    /// CHECK: Created manually with Token-2022 extensions
    #[account(
        mut,
        signer,
    )]
    pub access_nft_mint: AccountInfo<'info>,

    /// Purchaser's NFT token account (Associated Token Account for the access NFT)
    #[account(
        init_if_needed,
        payer = purchaser,
        associated_token::mint = access_nft_mint,
        associated_token::authority = purchaser,
    )]
    pub purchaser_nft_account: InterfaceAccount<'info, TokenAccount>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    /// Global state to get treasury address
    #[account(
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Treasury's collection token account (receives purchase fee, configurable via GlobalState)
    /// CHECK: Validated against global_state.treasury
    #[account(
        mut,
        constraint = treasury_token_account.owner == global_state.treasury @ ProtocolError::Unauthorized,
        constraint = treasury_token_account.mint == collection_mint.key() @ ProtocolError::Unauthorized
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    /// Token-2022 program for NFT with extensions
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
    
    /// CHECK: Metaplex Token Metadata account (PDA derived from mint)
    /// This account will be created to store NFT metadata including collection, purchaser, and purchased_at
    /// PDA derivation: ["metadata", METADATA_PROGRAM_ID, mint]
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,
    
    /// CHECK: Metaplex Token Metadata program
    /// Validated via address constraint to ensure it's the correct program
    #[account(address = METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
}

/// Purchase access to a collection
/// Splits payment: 50% to staking pool (for token holders), 50% to escrow (for peers)
/// Mints a non-transferable Access NFT to the purchaser as proof of access rights
/// Note: Any remainder (dust) from odd amounts is added to the staking pool
pub fn purchase_access(
    ctx: Context<PurchaseAccess>,
    total_amount: u64,
    cid_hash: [u8; 32],
) -> Result<()> {
    require!(total_amount > 0, ProtocolError::InsufficientFunds);

    let clock = &ctx.accounts.clock;
    let access_escrow = &mut ctx.accounts.access_escrow;
    let staking_pool = &mut ctx.accounts.staking_pool;
    let collection = &ctx.accounts.collection;

    // ⚠️ SECURITY: Prevent purchases of blacklisted collections
    // This enforces the blacklist at the blockchain level, preventing direct on-chain bypass
    // Design Requirement 3.2.A: is_blacklisted is a "Moderator toggle for illegal content"
    // Design Requirement 5.2: "official client will refuse to resolve... effectively de-platforming"
    require!(!collection.is_blacklisted, ProtocolError::Unauthorized);

    // Verify cid_hash matches collection's cid_hash
    require!(
        cid_hash == collection.cid_hash,
        ProtocolError::Unauthorized
    );

    // ============================================================================
    // Calculate Purchase Fee (configurable via GlobalState) - Only on purchases/sales
    // Fees are manually collected and sent to treasury, not automatically deducted
    // Default is 2% (200 basis points), but can be updated by admin via update_global_state
    // ============================================================================
    let fee_basis_points = ctx.accounts.global_state.fee_basis_points as u64;
    let fee_denominator = 10000u64;
    
    // Calculate total fee on purchase (ceiling division to favor treasury)
    let total_fee = total_amount
        .checked_mul(fee_basis_points)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_add(fee_denominator - 1) // Add denominator - 1 for ceiling division
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(fee_denominator)
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Amount after fee deduction
    let amount_after_fee = total_amount
        .checked_sub(total_fee)
        .ok_or(ProtocolError::MathOverflow)?;

    // Calculate 50/50 split of remaining amount (after fee)
    let amount_to_stakers = amount_after_fee
        .checked_mul(SPLIT_TO_STAKERS)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;
    
    let amount_to_escrow = amount_after_fee
        .checked_mul(SPLIT_TO_PEERS_ESCROW)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Handle remainder (dust) from odd amounts - add to staking pool
    let total_split = amount_to_stakers
        .checked_add(amount_to_escrow)
        .ok_or(ProtocolError::MathOverflow)?;
    let remainder = amount_after_fee
        .checked_sub(total_split)
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Add remainder to staking pool (ensures all funds are distributed)
    let final_amount_to_stakers = amount_to_stakers
        .checked_add(remainder)
        .ok_or(ProtocolError::MathOverflow)?;

    // ============================================================================
    // STEP 1: Mint Non-Transferable Access NFT
    // ============================================================================
    
    // Calculate space needed for mint with NonTransferable extension
    let space = ExtensionType::try_calculate_account_len::<MintState>(&[
        ExtensionType::NonTransferable,
    ]).map_err(|_| ProtocolError::MathOverflow)?;
    
    let rent = ctx.accounts.rent.minimum_balance(space);
    let space_u64 = u64::try_from(space).map_err(|_| ProtocolError::MathOverflow)?;
    
    // Create the mint account
    invoke_signed(
        &system_instruction::create_account(
            ctx.accounts.purchaser.key,
            ctx.accounts.access_nft_mint.key,
            rent,
            space_u64,
            &token_2022::ID,
        ),
        &[
            ctx.accounts.purchaser.to_account_info(),
            ctx.accounts.access_nft_mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[],
    )?;

    // Initialize NonTransferable extension
    let mut mint_data = ctx.accounts.access_nft_mint.try_borrow_mut_data()?;
    let mut mint_with_extension = StateWithExtensionsMut::<MintState>::unpack_uninitialized(&mut mint_data)?;
    
    // Initialize the NonTransferable extension first (required before mint init)
    mint_with_extension.init_extension::<spl_token_2022::extension::non_transferable::NonTransferable>(true)?;
    
    // Initialize the mint: supply=1, decimals=0, freeze_authority=collection (for moderation)
    mint_with_extension.base = MintState {
        mint_authority: anchor_lang::solana_program::program_option::COption::Some(*ctx.accounts.purchaser.key),
        supply: 0, // Will be minted next
        decimals: 0,
        is_initialized: true,
        freeze_authority: anchor_lang::solana_program::program_option::COption::Some(collection.key()),
    };
    
    drop(mint_data); // Release the borrow

    msg!("NonTransferable Access NFT mint created: {}", ctx.accounts.access_nft_mint.key());

    // ============================================================================
    // CRITICAL: Mint 1 token to purchaser's Associated Token Account
    // ============================================================================
    
    // The ATA is automatically created via init_if_needed constraint above
    // Now mint exactly 1 token to the purchaser's ATA
    let mint_to_accounts = MintTo {
        mint: ctx.accounts.access_nft_mint.to_account_info(),
        to: ctx.accounts.purchaser_nft_account.to_account_info(),
        authority: ctx.accounts.purchaser.to_account_info(),
    };
    let mint_to_ctx = CpiContext::new(
        ctx.accounts.token_2022_program.to_account_info(),
        mint_to_accounts,
    );
    mint_to(mint_to_ctx, 1)?; // Mint exactly 1 token (NFT)
    
    msg!("Minted 1 Access NFT token to purchaser: {}", ctx.accounts.purchaser.key());

    // ============================================================================
    // CRITICAL: Create Metaplex Token Metadata Account
    // This enables pinners to verify collection_id and access details on-chain
    // Design Requirement 3.3.A: Metadata includes collection, purchaser, and purchased_at
    // ============================================================================
    
    let collection_id_str = collection.collection_id.clone();
    let metadata_name = format!("Access Pass: {}", collection_id_str);
    let metadata_symbol = "ACCESS".to_string();
    // URI points to off-chain JSON containing purchaser and purchased_at
    // The off-chain JSON should follow this structure:
    // {
    //   "name": "Access Pass: {collection_id}",
    //   "description": "Access NFT for collection",
    //   "image": "{collection_thumbnail_uri}",
    //   "attributes": [
    //     { "trait_type": "collection_id", "value": "{collection_id}" },
    //     { "trait_type": "purchaser", "value": "{purchaser_pubkey}" },
    //     { "trait_type": "purchased_at", "value": {timestamp} }
    //   ]
    // }
    // For now, use empty URI - client should upload metadata and update URI after purchase
    let metadata_uri = String::new();
    
    // Construct metadata data structure
    let metadata_data = DataV2 {
        name: metadata_name,
        symbol: metadata_symbol,
        uri: metadata_uri,
        seller_fee_basis_points: 0, // No royalties on access NFTs
        creators: None, // No creators for access NFTs
        collection: None, // Collection reference would go here if we had a collection NFT
        uses: None, // No uses restrictions
    };
    
    // Create metadata account via CPI to Metaplex Token Metadata program
    let create_metadata_instruction = create_metadata_accounts_v3(
        ctx.accounts.token_metadata_program.key(),
        ctx.accounts.metadata_account.key(),
        ctx.accounts.access_nft_mint.key(),
        ctx.accounts.purchaser.key(), // mint_authority
        ctx.accounts.purchaser.key(), // payer
        ctx.accounts.purchaser.key(), // update_authority
        metadata_data,
        false, // is_mutable: Immutable metadata ensures integrity
        None,  // collection_details
        None,  // uses
    );
    
    invoke_signed(
        &create_metadata_instruction,
        &[
            ctx.accounts.metadata_account.to_account_info(),
            ctx.accounts.access_nft_mint.to_account_info(),
            ctx.accounts.purchaser.to_account_info(), // mint_authority
            ctx.accounts.purchaser.to_account_info(), // payer
            ctx.accounts.purchaser.to_account_info(), // update_authority
            ctx.accounts.token_metadata_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ],
        &[], // Purchaser signs the transaction, so no additional signers needed
    )?;
    
    msg!(
        "Created Metaplex metadata for Access NFT: {} Collection: {} Purchaser: {} PurchasedAt: {}",
        ctx.accounts.access_nft_mint.key(),
        collection_id_str,
        ctx.accounts.purchaser.key(),
        clock.unix_timestamp
    );

    // ============================================================================
    // CRITICAL: Revoke mint authority to prevent additional minting
    // This ensures the supply stays at exactly 1 (making it a true NFT)
    // ============================================================================
    
    let purchaser_key = ctx.accounts.purchaser.key();
    let mint_key = ctx.accounts.access_nft_mint.key();
    
    let set_authority_ix = set_authority(
        ctx.accounts.token_2022_program.key,
        &mint_key,
        None, // New authority = None (revoked)
        AuthorityType::MintTokens,
        &purchaser_key, // Current authority (must sign)
        &[], // Signers array (empty since purchaser signs the transaction)
    )?;
    
    invoke_signed(
        &set_authority_ix,
        &[
            ctx.accounts.access_nft_mint.to_account_info(),
            ctx.accounts.purchaser.to_account_info(),
            ctx.accounts.token_2022_program.to_account_info(),
        ],
        &[],
    )?;
    
    msg!("Revoked mint authority for Access NFT: {}", ctx.accounts.access_nft_mint.key());
    
    // Store the mint address for escrow reference
    let nft_mint_key = ctx.accounts.access_nft_mint.key();

    // ============================================================================
    // STEP 2: Initialize the escrow with NFT reference
    // ============================================================================
    
    access_escrow.purchaser = ctx.accounts.purchaser.key();
    access_escrow.collection = collection.key();
    access_escrow.access_nft_mint = nft_mint_key;
    access_escrow.cid_hash = cid_hash;
    access_escrow.amount_locked = amount_to_escrow; // Full amount (no fees deducted)
    access_escrow.created_at = clock.unix_timestamp;
    access_escrow.is_cid_revealed = false;
    access_escrow.bump = ctx.bumps.access_escrow;

    // ============================================================================
    // STEP 3: Transfer purchase fee to treasury (manual fee collection on purchases)
    // Fee percentage is configurable via GlobalState.fee_basis_points
    // ============================================================================
    
    if total_fee > 0 {
        let transfer_fee = TransferChecked {
            from: ctx.accounts.purchaser_token_account.to_account_info(),
            mint: ctx.accounts.collection_mint.to_account_info(),
            to: ctx.accounts.treasury_token_account.to_account_info(),
            authority: ctx.accounts.purchaser.to_account_info(),
        };
        let cpi_ctx_fee = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_fee);
        anchor_spl::token_interface::transfer_checked(cpi_ctx_fee, total_fee, ctx.accounts.collection_mint.decimals)?;
    }

    // ============================================================================
    // STEP 4: Transfer 50% to staking pool (after fee deduction, including remainder)
    // ============================================================================
    
    let transfer_to_pool = TransferChecked {
        from: ctx.accounts.purchaser_token_account.to_account_info(),
        mint: ctx.accounts.collection_mint.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.purchaser.to_account_info(),
    };
    let cpi_ctx_pool = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_to_pool);
    anchor_spl::token_interface::transfer_checked(cpi_ctx_pool, final_amount_to_stakers, ctx.accounts.collection_mint.decimals)?;

    // Distribute rewards to stakers (full amount including remainder, no fees deducted)
    if staking_pool.total_staked > 0 {
        let reward_increment = (final_amount_to_stakers as u128)
            .checked_mul(REWARD_PRECISION)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(staking_pool.total_staked as u128)
            .ok_or(ProtocolError::MathOverflow)?;
        
        staking_pool.reward_per_token = staking_pool.reward_per_token
            .checked_add(reward_increment)
            .ok_or(ProtocolError::MathOverflow)?;
    }

    // ============================================================================
    // STEP 5: Transfer 50% to escrow (after fee deduction)
    // ============================================================================
    
    let transfer_to_escrow = TransferChecked {
        from: ctx.accounts.purchaser_token_account.to_account_info(),
        mint: ctx.accounts.collection_mint.to_account_info(),
        to: ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.purchaser.to_account_info(),
    };
    let cpi_ctx_escrow = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_to_escrow);
    anchor_spl::token_interface::transfer_checked(cpi_ctx_escrow, amount_to_escrow, ctx.accounts.collection_mint.decimals)?;

    msg!(
        "AccessPurchased: Purchaser={} Collection={} NFT={} Total={} Fee={} ToStakers={} ToEscrow={} Remainder={} ExpiresAt={}",
        ctx.accounts.purchaser.key(),
        collection.collection_id,
        nft_mint_key,
        total_amount,
        total_fee,
        final_amount_to_stakers,
        amount_to_escrow,
        remainder,
        clock.unix_timestamp + ESCROW_EXPIRY_SECONDS
    );

    Ok(())
}

// ============================================================================
// Legacy Create Access Escrow (kept for backward compatibility)
// ============================================================================

#[derive(Accounts)]
pub struct CreateAccessEscrow<'info> {
    #[account(mut)]
    pub purchaser: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: Purchaser's Collection Token account (source of tokens for escrow)
    #[account(mut)]
    pub purchaser_token_account: UncheckedAccount<'info>,

    /// CHECK: Access Escrow token account (PDA) that will hold the locked tokens
    #[account(mut)]
    pub escrow_token_account: UncheckedAccount<'info>,

    /// Access Escrow PDA - will be created
    #[account(
        init,
        payer = purchaser,
        space = AccessEscrow::MAX_SIZE,
        seeds = [SEED_ACCESS_ESCROW, purchaser.key().as_ref(), collection.key().as_ref()],
        bump
    )]
    pub access_escrow: Account<'info, AccessEscrow>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

/// Creates an AccessEscrow after user has swapped CAPGM for Collection Tokens via Orca.
/// NOTE: This is a legacy function. Use purchase_access for the new 50/50 split flow with NFT minting.
pub fn create_access_escrow(
    ctx: Context<CreateAccessEscrow>,
    amount_locked: u64,
    cid_hash: [u8; 32],
    access_nft_mint: Pubkey,
) -> Result<()> {
    require!(amount_locked > 0, ProtocolError::InsufficientFunds);

    let clock = &ctx.accounts.clock;
    let access_escrow = &mut ctx.accounts.access_escrow;
    let collection = &ctx.accounts.collection;

    // ⚠️ SECURITY: Prevent purchases of blacklisted collections
    // This enforces the blacklist at the blockchain level, preventing direct on-chain bypass
    require!(!collection.is_blacklisted, ProtocolError::Unauthorized);

    // Verify cid_hash matches collection's cid_hash
    require!(
        cid_hash == collection.cid_hash,
        ProtocolError::Unauthorized
    );

    // Initialize the escrow
    access_escrow.purchaser = ctx.accounts.purchaser.key();
    access_escrow.collection = collection.key();
    access_escrow.access_nft_mint = access_nft_mint;
    access_escrow.cid_hash = cid_hash;
    access_escrow.amount_locked = amount_locked;
    access_escrow.created_at = clock.unix_timestamp;
    access_escrow.is_cid_revealed = false;
    access_escrow.bump = ctx.bumps.access_escrow;

    // Transfer tokens from purchaser to escrow token account
    let transfer_ix = TransferChecked {
        from: ctx.accounts.purchaser_token_account.to_account_info(),
        mint: ctx.accounts.collection_mint.to_account_info(),
        to: ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.purchaser.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, transfer_ix);
    anchor_spl::token_interface::transfer_checked(cpi_ctx, amount_locked, ctx.accounts.collection_mint.decimals)?;

    msg!(
        "AccessEscrowCreated: Purchaser={} Collection={} Amount={}",
        ctx.accounts.purchaser.key(),
        collection.collection_id,
        amount_locked
    );

    Ok(())
}

// ============================================================================
// Release Escrow - Buyer-controlled payment to peers
// ============================================================================

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(mut)]
    pub purchaser: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// Access Escrow PDA - must be owned by purchaser and not expired
    #[account(
        mut,
        seeds = [SEED_ACCESS_ESCROW, purchaser.key().as_ref(), collection.key().as_ref()],
        bump = access_escrow.bump,
        constraint = access_escrow.purchaser == purchaser.key() @ ProtocolError::Unauthorized,
        constraint = access_escrow.collection == collection.key() @ ProtocolError::Unauthorized
    )]
    pub access_escrow: Account<'info, AccessEscrow>,

    /// CHECK: Escrow token account (source of funds) - must be owned by escrow PDA
    #[account(mut)]
    pub escrow_token_account: UncheckedAccount<'info>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
    
    // Remaining accounts: For each peer, provide [peer_token_account, peer_trust_state]
    // peer_token_account: Token account to receive payment
    // peer_trust_state: PeerTrustState PDA (will be created if doesn't exist)
    // Note: Accounts must be provided in pairs, matching the order of peer_wallets
}

/// Releases escrow funds to peer wallets based on their contribution to content delivery.
/// This implements the "Trust-Based Delivery" mechanism where the BUYER determines payment.
/// Only the purchaser can call this function, and they decide which peers get paid.
pub fn release_escrow<'info>(
    ctx: Context<'_, '_, '_, 'info, ReleaseEscrow<'info>>,
    peer_wallets: Vec<Pubkey>,
    peer_weights: Vec<u64>,
) -> Result<()> {
    require!(
        peer_wallets.len() == peer_weights.len() && !peer_wallets.is_empty(),
        ProtocolError::InvalidFeeConfig
    );

    // Validate peer list length to prevent computation budget issues
    require!(
        peer_wallets.len() <= MAX_PEER_LIST_LENGTH,
        ProtocolError::PeerListTooLong
    );

    // Get all keys and data before mutable borrows to avoid lifetime issues
    let access_escrow_key = ctx.accounts.access_escrow.key();
    let access_escrow_account_info = ctx.accounts.access_escrow.to_account_info();
    let escrow_token_account_key = *ctx.accounts.escrow_token_account.key;
    let token_program_key = *ctx.accounts.token_program.key;
    let mint_account_info = ctx.accounts.collection_mint.to_account_info();
    let mint_key = *mint_account_info.key;
    let mint_decimals = ctx.accounts.collection_mint.decimals;

    let access_escrow = &mut ctx.accounts.access_escrow;
    let clock = &ctx.accounts.clock;

    // Check if escrow has expired (24 hours)
    let time_elapsed = clock.unix_timestamp
        .checked_sub(access_escrow.created_at)
        .ok_or(ProtocolError::MathOverflow)?;
    
    require!(
        time_elapsed <= ESCROW_EXPIRY_SECONDS,
        ProtocolError::EscrowExpired
    );

    require!(
        access_escrow.amount_locked > 0,
        ProtocolError::InsufficientFunds
    );

    let total_weight: u64 = peer_weights.iter().sum();
    require!(total_weight > 0, ProtocolError::InvalidFeeConfig);

    let amount_locked = access_escrow.amount_locked;
    let purchaser_key = access_escrow.purchaser;
    let collection_key = access_escrow.collection;
    let escrow_bump = access_escrow.bump;
    
    // Get collection info before mutable borrow
    let collection_owner = ctx.accounts.collection.owner;
    let collection_id = ctx.accounts.collection.collection_id.clone();
    let collection_bump = ctx.bumps.collection;
    let collection_seeds = [
        b"collection".as_ref(),
        collection_owner.as_ref(),
        collection_id.as_bytes(),
        &[collection_bump],
    ];
    let _collection_signer_seeds: &[&[&[u8]]] = &[&collection_seeds];

    // Distribute tokens to peers based on weights
    // Remaining accounts should be provided in pairs: [peer_token_account, peer_trust_state] for each peer
    // ⚠️ CRITICAL: Client MUST mark peer_trust_state accounts as writable (is_writable: true)
    // If not writable, try_borrow_mut_data() will panic at runtime
    let remaining_accounts = ctx.remaining_accounts;
    require!(
        remaining_accounts.len() >= peer_wallets.len() * 2,
        ProtocolError::InvalidFeeConfig
    );

    // Track total amount sent to ensure we don't exceed escrow balance
    let mut total_sent = 0u64;
    
    for (i, peer_wallet) in peer_wallets.iter().enumerate() {
        let weight = peer_weights[i];
        // Calculate peer's proportional share of amount_locked (no fees deducted)
        let peer_share = amount_locked
            .checked_mul(weight)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(total_weight)
            .ok_or(ProtocolError::MathOverflow)?;
        
        // Verify we have enough balance remaining
        let remaining_balance = amount_locked
            .checked_sub(total_sent)
            .ok_or(ProtocolError::MathOverflow)?;
        
        // Adjust for rounding - use remaining balance if peer_share would exceed it
        let peer_amount = if peer_share > remaining_balance {
            remaining_balance
        } else {
            peer_share
        };

        if peer_amount > 0 {
            let account_idx = i * 2;
            let peer_token_account_info = &remaining_accounts[account_idx];
            let peer_trust_state_info = &remaining_accounts[account_idx + 1];

            // ⚠️ SECURITY: Verify peer_token_account owner matches peer_wallet
            // SPL Token account structure: mint (32 bytes) + owner (32 bytes) + amount (8 bytes)
            let token_account_data = peer_token_account_info.try_borrow_data()?;
            require!(
                token_account_data.len() >= 64, // At least mint (32) + owner (32) bytes
                ProtocolError::InvalidAccount
            );
            
            // Extract owner from token account (offset 32-63)
            let owner_bytes: [u8; 32] = token_account_data[32..64]
                .try_into()
                .map_err(|_| ProtocolError::InvalidAccount)?;
            let token_account_owner = Pubkey::try_from(owner_bytes)
                .map_err(|_| ProtocolError::InvalidAccount)?;
            
            require!(
                token_account_owner == *peer_wallet,
                ProtocolError::Unauthorized
            );
            
            // ⚠️ SECURITY: Verify mint matches collection_mint to prevent sending wrong token type
            let mint_bytes: [u8; 32] = token_account_data[0..32]
                .try_into()
                .map_err(|_| ProtocolError::InvalidAccount)?;
            let token_account_mint = Pubkey::try_from(mint_bytes)
                .map_err(|_| ProtocolError::InvalidAccount)?;
            
            require!(
                token_account_mint == mint_key,
                ProtocolError::Unauthorized
            );
            
            // Verify and update/create PeerTrustState
            let (expected_peer_trust_pda, _peer_trust_bump) = Pubkey::find_program_address(
                &[SEED_PEER_TRUST, peer_wallet.as_ref()],
                ctx.program_id,
            );

            require!(
                peer_trust_state_info.key() == expected_peer_trust_pda,
                ProtocolError::Unauthorized
            );
            
            // ⚠️ SECURITY: Verify account is owned by this program (prevents malicious account injection)
            require!(
                peer_trust_state_info.owner == ctx.program_id,
                ProtocolError::Unauthorized
            );

            // Update PeerTrustState if it exists
            let mut trust_score_update = weight;
            if !peer_trust_state_info.data_is_empty() {
                // Update existing PeerTrustState
                // ⚠️ CRITICAL: This will panic if peer_trust_state_info is not marked as writable
                // The client MUST set is_writable: true for all peer_trust_state accounts
                let mut state = PeerTrustState::try_deserialize(&mut &peer_trust_state_info.data.borrow()[8..])?;
                require!(
                    state.peer_wallet == *peer_wallet,
                    ProtocolError::Unauthorized
                );
                state.total_successful_serves = state.total_successful_serves
                    .checked_add(1)
                    .ok_or(ProtocolError::MathOverflow)?;
                state.trust_score = state.trust_score
                    .checked_add(weight)
                    .ok_or(ProtocolError::MathOverflow)?;
                state.last_active = clock.unix_timestamp;
                trust_score_update = state.trust_score;
                
                // ⚠️ SECURITY: try_borrow_mut_data() will fail if account is not writable
                // This is intentional - it prevents silent failures and ensures client correctness
                let mut data = peer_trust_state_info.try_borrow_mut_data()
                    .map_err(|_| ProtocolError::InvalidAccount)?; // Convert to protocol error
                state.try_serialize(&mut &mut data[8..])?;
            } else {
                // Account doesn't exist yet - would need separate initialization with rent
                // For now, we skip trust score update if account doesn't exist
                msg!("PeerTrustState not initialized for peer: {} - skipping trust update", peer_wallet);
            }

            // Transfer tokens from escrow to peer token account using invoke_signed
            let escrow_seeds = [
                SEED_ACCESS_ESCROW,
                purchaser_key.as_ref(),
                collection_key.as_ref(),
                &[escrow_bump],
            ];
            let signer_seeds = &[&escrow_seeds[..]];

            // Create the SPL token transfer_checked instruction
            let transfer_instruction = spl_transfer_checked(
                &token_program_key,
                &escrow_token_account_key,
                &mint_key,
                peer_token_account_info.key,
                &access_escrow_key, // AccessEscrow PDA is the authority (owner of token account)
                &[],
                peer_amount,
                mint_decimals,
            )?;

            // Invoke with the escrow PDA as signer
            invoke_signed(
                &transfer_instruction,
                &[
                    ctx.accounts.escrow_token_account.to_account_info(),
                    ctx.accounts.collection_mint.to_account_info(),
                    peer_token_account_info.clone(),
                    access_escrow_account_info.clone(), // Required: signer account must be in accounts array
                    ctx.accounts.token_program.to_account_info(),
                ],
                signer_seeds,
            )?;

            // Update total sent
            total_sent = total_sent
                .checked_add(peer_amount)
                .ok_or(ProtocolError::MathOverflow)?;
            
            msg!(
                "PeerPayment: Peer={} Amount={} Weight={} TrustScore={}",
                peer_wallet,
                peer_amount,
                weight,
                trust_score_update
            );
        }
    }

    // Update collection's total trust score and clear the escrow
    let collection = &mut ctx.accounts.collection;
    let total_trust_increment: u64 = peer_weights.iter().sum();
    collection.total_trust_score = collection.total_trust_score
        .checked_add(total_trust_increment)
        .ok_or(ProtocolError::MathOverflow)?;
    
    access_escrow.amount_locked = 0;

    msg!(
        "EscrowReleased: Purchaser={} Collection={} TotalAmount={} Peers={}",
        ctx.accounts.purchaser.key(),
        collection_id,
        amount_locked,
        peer_wallets.len()
    );

    // Emit event for off-chain indexer to track peer performance history
    emit!(EscrowReleasedEvent {
        purchaser: ctx.accounts.purchaser.key(),
        collection: collection_key,
        total_amount: amount_locked,
        peer_wallets: peer_wallets.clone(),
        peer_weights: peer_weights.clone(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ============================================================================
// Burn Expired Escrow - Permissionless 24-hour cleanup
// ============================================================================

#[derive(Accounts)]
pub struct BurnExpiredEscrow<'info> {
    /// CHECK: Anyone can call this permissionless instruction
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// Access Escrow PDA - must be expired
    #[account(
        mut,
        seeds = [SEED_ACCESS_ESCROW, access_escrow.purchaser.as_ref(), collection.key().as_ref()],
        bump = access_escrow.bump,
        close = caller  // Return rent to caller as incentive
    )]
    pub access_escrow: Account<'info, AccessEscrow>,

    /// CHECK: Escrow token account holding the tokens to burn
    #[account(mut)]
    pub escrow_token_account: UncheckedAccount<'info>,

    /// Collection token mint for burning
    /// CHECK: Verified via collection state
    #[account(
        mut,
        constraint = collection_mint.key() == collection.mint @ ProtocolError::Unauthorized
    )]
    pub collection_mint: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub clock: Sysvar<'info, Clock>,
}

/// Permissionless instruction to burn tokens in expired escrow accounts (after 24 hours).
/// This creates deflationary pressure and cleans up abandoned escrow accounts.
/// Anyone can call this and receive the escrow account rent as an incentive.
/// 
/// Note: Burns the actual token account balance (not amount_locked) to handle dust
/// remaining from integer division rounding in release_escrow.
pub fn burn_expired_escrow(ctx: Context<BurnExpiredEscrow>) -> Result<()> {
    let access_escrow = &ctx.accounts.access_escrow;
    let clock = &ctx.accounts.clock;

    // Check if escrow has expired (24 hours)
    let time_elapsed = clock.unix_timestamp
        .checked_sub(access_escrow.created_at)
        .ok_or(ProtocolError::MathOverflow)?;
    
    require!(
        time_elapsed > ESCROW_EXPIRY_SECONDS,
        ProtocolError::EscrowNotExpired
    );

    // Read actual token account balance (handles dust from rounding)
    // SPL Token account structure: mint (32 bytes) + owner (32 bytes) + amount (8 bytes) at offset 64
    let token_account_data = ctx.accounts.escrow_token_account.try_borrow_data()?;
    require!(
        token_account_data.len() >= 72, // At least 64 + 8 bytes
        ProtocolError::InvalidAccount
    );
    let amount_bytes = &token_account_data[64..72];
    let actual_balance = u64::from_le_bytes(
        amount_bytes.try_into().map_err(|_| ProtocolError::InvalidAccount)?
    );
    
    require!(actual_balance > 0, ProtocolError::InsufficientFunds);
    
    // Use actual token account balance instead of amount_locked to handle dust
    let amount_to_burn = actual_balance;

    // Burn the tokens permanently (reduces collection token supply)
    let burn_ix = Burn {
        mint: ctx.accounts.collection_mint.to_account_info(),
        from: ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.escrow_token_account.to_account_info(), // PDA authority
    };
    
    // Use escrow PDA as authority
    let escrow_seeds = [
        SEED_ACCESS_ESCROW,
        access_escrow.purchaser.as_ref(),
        access_escrow.collection.as_ref(),
        &[access_escrow.bump],
    ];
    let signer_seeds = &[&escrow_seeds[..]];
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        burn_ix,
        signer_seeds,
    );
    burn(cpi_ctx, amount_to_burn)?;

    msg!(
        "ExpiredEscrowBurned: Purchaser={} Collection={} Amount={} Caller={} TimeElapsed={}s",
        access_escrow.purchaser,
        ctx.accounts.collection.collection_id,
        amount_to_burn,
        ctx.accounts.caller.key(),
        time_elapsed
    );

    // AccessEscrow account is automatically closed via the close constraint
    // Rent is returned to the caller as an incentive

    Ok(())
}

// ============================================================================
// Reveal CID - Pinner encrypts and reveals CID to purchaser
// ============================================================================

#[derive(Accounts)]
pub struct RevealCid<'info> {
    #[account(mut)]
    pub pinner: Signer<'info>,

    #[account(
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// Access Escrow PDA - must exist and not yet have CID revealed
    #[account(
        mut,
        seeds = [SEED_ACCESS_ESCROW, access_escrow.purchaser.as_ref(), collection.key().as_ref()],
        bump = access_escrow.bump,
        constraint = !access_escrow.is_cid_revealed @ ProtocolError::Unauthorized
    )]
    pub access_escrow: Account<'info, AccessEscrow>,

    /// CID Reveal PDA - will be created
    #[account(
        init,
        payer = pinner,
        space = CidReveal::MAX_SIZE,
        seeds = [SEED_CID_REVEAL, access_escrow.key().as_ref(), pinner.key().as_ref()],
        bump
    )]
    pub cid_reveal: Account<'info, CidReveal>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

/// Pinner reveals the encrypted CID to the purchaser.
/// The CID is encrypted with the purchaser's public key (X25519-XSalsa20-Poly1305).
/// Only the purchaser can decrypt it using their private wallet key.
pub fn reveal_cid(
    ctx: Context<RevealCid>,
    encrypted_cid: Vec<u8>,
) -> Result<()> {
    require!(!encrypted_cid.is_empty(), ProtocolError::InvalidFeeConfig);
    require!(encrypted_cid.len() <= 200, ProtocolError::InvalidFeeConfig); // Reasonable limit for encrypted CID

    let cid_reveal = &mut ctx.accounts.cid_reveal;
    let clock = &ctx.accounts.clock;
    
    // Get the escrow key before mutable borrow
    let escrow_key = ctx.accounts.access_escrow.key();
    let pinner_key = ctx.accounts.pinner.key();
    let purchaser_key = ctx.accounts.access_escrow.purchaser;
    let collection_id = ctx.accounts.collection.collection_id.clone();
    
    let access_escrow = &mut ctx.accounts.access_escrow;

    // Initialize the CID reveal
    cid_reveal.escrow = escrow_key;
    cid_reveal.pinner = pinner_key;
    cid_reveal.encrypted_cid = encrypted_cid.clone();
    cid_reveal.revealed_at = clock.unix_timestamp;
    cid_reveal.bump = ctx.bumps.cid_reveal;

    // Mark the escrow as having CID revealed
    access_escrow.is_cid_revealed = true;

    msg!(
        "CidRevealed: Pinner={} Purchaser={} Collection={} EncryptedCidLength={}",
        pinner_key,
        purchaser_key,
        collection_id,
        encrypted_cid.len()
    );

    Ok(())
}

// ============================================================================
// Initialize Peer Trust State
// ============================================================================

#[derive(Accounts)]
pub struct InitializePeerTrustState<'info> {
    /// The peer whose trust state is being initialized (pays rent)
    #[account(mut)]
    pub peer: Signer<'info>,

    #[account(
        init,
        payer = peer,
        space = PeerTrustState::MAX_SIZE,
        seeds = [SEED_PEER_TRUST, peer.key().as_ref()],
        bump
    )]
    pub peer_trust_state: Account<'info, PeerTrustState>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

/// Initializes a PeerTrustState account for a peer.
/// This allows new peers to start building their trust score.
/// The peer must sign this transaction and pay the rent for account creation.
/// This account must be initialized before a peer can accumulate trust_score
/// through the release_escrow instruction.
pub fn initialize_peer_trust_state(ctx: Context<InitializePeerTrustState>) -> Result<()> {
    let peer_trust_state = &mut ctx.accounts.peer_trust_state;
    let clock = &ctx.accounts.clock;

    peer_trust_state.peer_wallet = ctx.accounts.peer.key();
    peer_trust_state.total_successful_serves = 0;
    peer_trust_state.trust_score = 0;
    peer_trust_state.last_active = clock.unix_timestamp;

    msg!(
        "PeerTrustState initialized: Peer={} TrustScore={}",
        peer_trust_state.peer_wallet,
        peer_trust_state.trust_score
    );

    Ok(())
}

// Legacy function kept for backward compatibility if needed
// The new flow uses AccessEscrow instead of checking token balance
