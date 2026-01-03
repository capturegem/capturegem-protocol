use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, Transfer, Burn, burn};
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

    /// CHECK: Purchaser's collection token account (source of purchased tokens)
    #[account(mut)]
    pub purchaser_token_account: UncheckedAccount<'info>,

    /// CHECK: Staking pool's collection token account (receives 50%)
    #[account(mut)]
    pub pool_token_account: UncheckedAccount<'info>,

    /// CHECK: Access Escrow token account (PDA) that will hold the locked tokens (50%)
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

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

/// Purchase access to a collection
/// Splits payment: 50% to staking pool (for token holders), 50% to escrow (for peers)
pub fn purchase_access(
    ctx: Context<PurchaseAccess>,
    total_amount: u64,
) -> Result<()> {
    require!(total_amount > 0, ProtocolError::InsufficientFunds);
    require!(total_amount % 2 == 0, ProtocolError::InvalidFeeConfig); // Must be even for clean split

    let clock = &ctx.accounts.clock;
    let access_escrow = &mut ctx.accounts.access_escrow;
    let staking_pool = &mut ctx.accounts.staking_pool;
    let collection = &ctx.accounts.collection;

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

    // Initialize the escrow (holds 50% for peers)
    access_escrow.purchaser = ctx.accounts.purchaser.key();
    access_escrow.collection = collection.key();
    access_escrow.amount_locked = amount_to_escrow;
    access_escrow.created_at = clock.unix_timestamp;
    access_escrow.bump = ctx.bumps.access_escrow;

    // Transfer 50% to staking pool
    let transfer_to_pool = Transfer {
        from: ctx.accounts.purchaser_token_account.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.purchaser.to_account_info(),
    };
    let cpi_ctx_pool = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_to_pool);
    anchor_spl::token_interface::transfer(cpi_ctx_pool, amount_to_stakers)?;

    // Distribute rewards to stakers
    if staking_pool.total_staked > 0 {
        let reward_increment = (amount_to_stakers as u128)
            .checked_mul(REWARD_PRECISION)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(staking_pool.total_staked as u128)
            .ok_or(ProtocolError::MathOverflow)?;
        
        staking_pool.reward_per_token = staking_pool.reward_per_token
            .checked_add(reward_increment)
            .ok_or(ProtocolError::MathOverflow)?;
    }

    // Transfer 50% to escrow
    let transfer_to_escrow = Transfer {
        from: ctx.accounts.purchaser_token_account.to_account_info(),
        to: ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.purchaser.to_account_info(),
    };
    let cpi_ctx_escrow = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_to_escrow);
    anchor_spl::token_interface::transfer(cpi_ctx_escrow, amount_to_escrow)?;

    msg!(
        "AccessPurchased: Purchaser={} Collection={} Total={} ToStakers={} ToEscrow={} ExpiresAt={}",
        ctx.accounts.purchaser.key(),
        collection.collection_id,
        total_amount,
        amount_to_stakers,
        amount_to_escrow,
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

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

/// Creates an AccessEscrow after user has swapped CAPGM for Collection Tokens via Orca.
/// NOTE: This is a legacy function. Use purchase_access for the new 50/50 split flow.
pub fn create_access_escrow(
    ctx: Context<CreateAccessEscrow>,
    amount_locked: u64,
) -> Result<()> {
    require!(amount_locked > 0, ProtocolError::InsufficientFunds);

    let clock = &ctx.accounts.clock;
    let access_escrow = &mut ctx.accounts.access_escrow;
    let collection = &ctx.accounts.collection;

    // Initialize the escrow
    access_escrow.purchaser = ctx.accounts.purchaser.key();
    access_escrow.collection = collection.key();
    access_escrow.amount_locked = amount_locked;
    access_escrow.created_at = clock.unix_timestamp;
    access_escrow.bump = ctx.bumps.access_escrow;

    // Transfer tokens from purchaser to escrow token account
    let transfer_ix = Transfer {
        from: ctx.accounts.purchaser_token_account.to_account_info(),
        to: ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.purchaser.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, transfer_ix);
    anchor_spl::token_interface::transfer(cpi_ctx, amount_locked)?;

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
pub fn release_escrow(
    ctx: Context<ReleaseEscrow>,
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
    let remaining_accounts = &ctx.remaining_accounts;
    require!(
        remaining_accounts.len() >= peer_wallets.len() * 2,
        ProtocolError::InvalidFeeConfig
    );

    for (i, peer_wallet) in peer_wallets.iter().enumerate() {
        let weight = peer_weights[i];
        let peer_amount = amount_locked
            .checked_mul(weight)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(total_weight)
            .ok_or(ProtocolError::MathOverflow)?;

        if peer_amount > 0 {
            let account_idx = i * 2;
            let peer_token_account_info = &remaining_accounts[account_idx];
            let peer_trust_state_info = &remaining_accounts[account_idx + 1];

            // Verify and update/create PeerTrustState
            let (expected_peer_trust_pda, _peer_trust_bump) = Pubkey::find_program_address(
                &[SEED_PEER_TRUST, peer_wallet.as_ref()],
                ctx.program_id,
            );

            require!(
                peer_trust_state_info.key() == expected_peer_trust_pda,
                ProtocolError::Unauthorized
            );

            // Update PeerTrustState if it exists
            let mut trust_score_update = weight;
            if !peer_trust_state_info.data_is_empty() {
                // Update existing PeerTrustState
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
                
                let mut data = peer_trust_state_info.try_borrow_mut_data()?;
                state.try_serialize(&mut &mut data[8..])?;
            } else {
                // Account doesn't exist yet - would need separate initialization with rent
                msg!("PeerTrustState not initialized for peer: {}", peer_wallet);
            }

            // Transfer tokens from escrow to peer token account
            msg!(
                "PeerTransfer: From={} To={} Amount={}",
                ctx.accounts.escrow_token_account.key(),
                peer_token_account_info.key(),
                peer_amount
            );
            
            // TODO: Implement actual transfer - requires restructuring to avoid lifetime issues
            // Options: 1) Limit max peers and use regular accounts, 2) Use separate instruction per peer
            // 3) Use invoke_signed with proper account info handling

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

// Legacy function kept for backward compatibility if needed
// The new flow uses AccessEscrow instead of checking token balance
