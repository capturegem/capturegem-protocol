use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_interface::{TokenInterface, TransferChecked, Burn, burn, Mint, TokenAccount};
use anchor_spl::token_2022::{self, Token2022};
use spl_token_2022::extension::{ExtensionType, StateWithExtensionsMut, BaseStateWithExtensionsMut};
use spl_token_2022::state::Mint as MintState;
use spl_token_2022::instruction::transfer_checked as spl_transfer_checked;
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

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

    /// CHECK: Purchaser's NFT token account (will be created to hold the access NFT)
    #[account(mut)]
    pub purchaser_nft_account: UncheckedAccount<'info>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    /// Token-2022 program for NFT with extensions
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub clock: Sysvar<'info, Clock>,
}

/// Purchase access to a collection
/// Splits payment: 50% to staking pool (for token holders), 50% to escrow (for peers)
/// Mints a non-transferable Access NFT to the purchaser as proof of access rights
pub fn purchase_access(
    ctx: Context<PurchaseAccess>,
    total_amount: u64,
    cid_hash: [u8; 32],
) -> Result<()> {
    require!(total_amount > 0, ProtocolError::InsufficientFunds);
    require!(total_amount % 2 == 0, ProtocolError::InvalidFeeConfig); // Must be even for clean split

    let clock = &ctx.accounts.clock;
    let access_escrow = &mut ctx.accounts.access_escrow;
    let staking_pool = &mut ctx.accounts.staking_pool;
    let collection = &ctx.accounts.collection;

    // Verify cid_hash matches collection's cid_hash
    require!(
        cid_hash == collection.cid_hash,
        ProtocolError::Unauthorized
    );

    // Calculate 50/50 split
    let amount_to_stakers = total_amount
        .checked_mul(SPLIT_TO_STAKERS)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;
    
    let amount_to_escrow = total_amount
        .checked_mul(SPLIT_TO_PEERS_ESCROW)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    // ============================================================================
    // CRITICAL: Calculate Transfer Fee deduction (1.5% = 150 basis points)
    // Token-2022 will automatically deduct 1.5% on each transfer, so we must
    // account for this in our state updates to prevent insolvency.
    // ============================================================================
    let fee_basis_points = 150u64; // 1.5% transfer fee (matches create_collection)
    let fee_denominator = 10000u64;

    // Calculate fees and net amounts for staking pool transfer
    let staker_fee = amount_to_stakers
        .checked_mul(fee_basis_points)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(fee_denominator)
        .ok_or(ProtocolError::MathOverflow)?;
    let net_to_stakers = amount_to_stakers
        .checked_sub(staker_fee)
        .ok_or(ProtocolError::MathOverflow)?;

    // Calculate fees and net amounts for escrow transfer
    let escrow_fee = amount_to_escrow
        .checked_mul(fee_basis_points)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(fee_denominator)
        .ok_or(ProtocolError::MathOverflow)?;
    let net_to_escrow = amount_to_escrow
        .checked_sub(escrow_fee)
        .ok_or(ProtocolError::MathOverflow)?;

    // ============================================================================
    // STEP 1: Mint Non-Transferable Access NFT
    // ============================================================================
    
    // Calculate space needed for mint with NonTransferable extension
    let space = ExtensionType::try_calculate_account_len::<MintState>(&[
        ExtensionType::NonTransferable,
    ]).map_err(|_| ProtocolError::MathOverflow)?;
    
    let rent = ctx.accounts.rent.minimum_balance(space);
    
    // Create the mint account
    invoke_signed(
        &system_instruction::create_account(
            ctx.accounts.purchaser.key,
            ctx.accounts.access_nft_mint.key,
            rent,
            space as u64,
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

    // TODO: In production, also:
    // 1. Create purchaser_nft_account (associated token account)
    // 2. Mint 1 token to purchaser_nft_account
    // 3. Add Metaplex metadata with collection info, purchased_at timestamp
    // 4. Revoke mint authority (so supply stays at 1)
    
    // For now, we store the mint address and log the event
    let nft_mint_key = ctx.accounts.access_nft_mint.key();

    // ============================================================================
    // STEP 2: Initialize the escrow with NFT reference
    // ============================================================================
    
    access_escrow.purchaser = ctx.accounts.purchaser.key();
    access_escrow.collection = collection.key();
    access_escrow.access_nft_mint = nft_mint_key;
    access_escrow.cid_hash = cid_hash;
    // CRITICAL: Store NET amount (after transfer fee) to match actual balance
    access_escrow.amount_locked = net_to_escrow;
    access_escrow.created_at = clock.unix_timestamp;
    access_escrow.is_cid_revealed = false;
    access_escrow.bump = ctx.bumps.access_escrow;

    // ============================================================================
    // STEP 3: Transfer 50% to staking pool
    // ============================================================================
    
    let transfer_to_pool = TransferChecked {
        from: ctx.accounts.purchaser_token_account.to_account_info(),
        mint: ctx.accounts.collection_mint.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.purchaser.to_account_info(),
    };
    let cpi_ctx_pool = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_to_pool);
    anchor_spl::token_interface::transfer_checked(cpi_ctx_pool, amount_to_stakers, ctx.accounts.collection_mint.decimals)?;

    // Distribute rewards to stakers
    // CRITICAL: Use NET amount (after transfer fee) to match actual tokens received
    if staking_pool.total_staked > 0 {
        let reward_increment = (net_to_stakers as u128)
            .checked_mul(REWARD_PRECISION)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(staking_pool.total_staked as u128)
            .ok_or(ProtocolError::MathOverflow)?;
        
        staking_pool.reward_per_token = staking_pool.reward_per_token
            .checked_add(reward_increment)
            .ok_or(ProtocolError::MathOverflow)?;
    }

    // ============================================================================
    // STEP 4: Transfer 50% to escrow
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
        "AccessPurchased: Purchaser={} Collection={} NFT={} Total={} GrossToStakers={} NetToStakers={} GrossToEscrow={} NetToEscrow={} StakerFee={} EscrowFee={} ExpiresAt={}",
        ctx.accounts.purchaser.key(),
        collection.collection_id,
        nft_mint_key,
        total_amount,
        amount_to_stakers,
        net_to_stakers,
        amount_to_escrow,
        net_to_escrow,
        staker_fee,
        escrow_fee,
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
    
    // ============================================================================
    // CRITICAL: Account for Transfer Fees on peer payments
    // 
    // The escrow balance (amount_locked) is the NET amount after the initial
    // transfer fee. When we send tokens to peers, Token-2022 will deduct a 1.5%
    // fee from the escrow for each transfer.
    //
    // IMPORTANT: The fee is deducted from the SOURCE (escrow), so if we send
    // X tokens, the escrow balance decreases by X (gross), and the peer receives
    // X - (X * 1.5%) = X * 0.985 (net).
    //
    // Since amount_locked is the net balance, we can only send up to amount_locked
    // total. We distribute amount_locked proportionally to peers. Each peer will
    // receive their share minus the 1.5% fee, but they remain proportional.
    //
    // Example: amount_locked = 49.25, 2 peers with equal weights
    // - Peer 1 gets: 24.625 gross → receives 24.255625 net (fee: 0.369375)
    // - Peer 2 gets: 24.625 gross → receives 24.255625 net (fee: 0.369375)
    // - Total sent: 49.25 (matches amount_locked)
    // - Total fees: 0.73875 (goes to treasury)
    // ============================================================================
    
    // Get all keys and data before the loop to avoid lifetime issues
    let escrow_token_account_key = *ctx.accounts.escrow_token_account.key;
    let token_program_key = *ctx.accounts.token_program.key;
    let mint_account_info = ctx.accounts.collection_mint.to_account_info();
    let mint_key = *mint_account_info.key;
    let mint_decimals = ctx.accounts.collection_mint.decimals;
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
    let fee_basis_points = 150u64; // 1.5% transfer fee
    let fee_denominator = 10000u64;
    
    for (i, peer_wallet) in peer_wallets.iter().enumerate() {
        let weight = peer_weights[i];
        // Calculate peer's proportional share of amount_locked (net balance)
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
        
        // Calculate the net amount peer will receive (after 1.5% fee deduction)
        let peer_net_received = peer_amount
            .checked_mul(fee_denominator - fee_basis_points)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(fee_denominator)
            .ok_or(ProtocolError::MathOverflow)?;

        if peer_amount > 0 {
            let account_idx = i * 2;
            let peer_token_account_info = &remaining_accounts[account_idx];
            let peer_trust_state_info = &remaining_accounts[account_idx + 1];

            // Validate peer_token_account is a valid token account
            // Note: We can't use Account<TokenAccount> here because it's in remaining_accounts
            // The transfer_checked CPI will fail if the account is invalid, providing runtime safety
            
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
                &escrow_token_account_key, // Escrow account is both source and authority
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
                    ctx.accounts.token_program.to_account_info(),
                ],
                signer_seeds,
            )?;

            // Update total sent (track gross amount, as that's what leaves the escrow)
            total_sent = total_sent
                .checked_add(peer_amount)
                .ok_or(ProtocolError::MathOverflow)?;
            
            let peer_fee = peer_amount
                .checked_sub(peer_net_received)
                .ok_or(ProtocolError::MathOverflow)?;
            
            msg!(
                "PeerPayment: Peer={} GrossSent={} NetReceived={} Fee={} Weight={} TrustScore={}",
                peer_wallet,
                peer_amount,
                peer_net_received,
                peer_fee,
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

    let amount_to_burn = access_escrow.amount_locked;
    require!(amount_to_burn > 0, ProtocolError::InsufficientFunds);

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

// Legacy function kept for backward compatibility if needed
// The new flow uses AccessEscrow instead of checking token balance
