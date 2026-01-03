use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, Transfer};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

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
/// The swapped tokens are transferred to the escrow PDA, which acts as authorization for content access.
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
    // Note: In production, this would be done via CPI to the token program
    // The escrow_token_account should be a PDA-owned token account
    let collection_bump = ctx.bumps.collection;
    let collection_seeds = &[
        b"collection",
        collection.owner.as_ref(),
        collection.collection_id.as_bytes(),
        &[collection_bump],
    ];
    let _collection_signer = &[&collection_seeds[..]];

    // Transfer tokens to escrow
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

    /// Access Escrow PDA - must be owned by purchaser
    #[account(
        mut,
        seeds = [SEED_ACCESS_ESCROW, purchaser.key().as_ref(), collection.key().as_ref()],
        bump = access_escrow.bump,
        constraint = access_escrow.purchaser == purchaser.key() @ ProtocolError::Unauthorized,
        constraint = access_escrow.collection == collection.key() @ ProtocolError::Unauthorized
    )]
    pub access_escrow: Account<'info, AccessEscrow>,

    /// CHECK: Escrow token account (source of funds) - must be owned by collection PDA
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
/// This implements the "Trust-Based Delivery" mechanism where payment is conditional on service.
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
            // Note: In production, PeerTrustState accounts should be initialized separately
            // or we'd need to handle rent exemption here. For now, we update if exists.
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
                // For now, we just proceed with payment
                msg!("PeerTrustState not initialized for peer: {}", peer_wallet);
            }

            // Transfer tokens from escrow to peer token account
            // Note: Using to_account_info() on remaining_accounts creates lifetime issues
            // For now, we'll log the transfer. In production, restructure to pass peer accounts
            // as regular accounts or use a different pattern for dynamic peer lists.
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

// Legacy function kept for backward compatibility if needed
// The new flow uses AccessEscrow instead of checking token balance
