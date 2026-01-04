// solana-program/programs/solana-program/src/instructions/moderation.rs
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TransferChecked, Mint};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

#[event]
pub struct CidCensorshipEvent {
    pub collection_id: String,
    pub censored_cid: String,
    pub moderator: Pubkey,
    pub timestamp: i64,
    pub approved: bool,
    pub reporter: Option<Pubkey>,
    pub video_index: u16,
}

#[derive(Accounts)]
#[instruction(target_id: String)]
pub struct CreateTicket<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    
    #[account(
        init,
        payer = reporter,
        // Calculate space dynamically: base size + 4 (vec length) + (claim_indices.len() * 2) bytes
        // For now, use a reasonable default (assume max 32 indices = 64 bytes)
        space = ModTicket::BASE_SIZE + 64,
        seeds = [b"ticket", target_id.as_bytes()],
        bump
    )]
    pub ticket: Account<'info, ModTicket>,
    
    /// Optional: Collection account (required if ticket_type is CopyrightClaim)
    /// Used to verify the claim deadline hasn't passed at ticket creation time
    #[account(mut)]
    pub collection: Option<Account<'info, CollectionState>>,
    
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(target_id: String)]
pub struct ResolveTicket<'info> {
    #[account(mut)]
    pub moderator: Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        seeds = [b"moderator_stake", moderator.key().as_ref()],
        bump,
        constraint = moderator_stake.is_active @ ProtocolError::InsufficientModeratorStake,
        constraint = moderator_stake.stake_amount >= global_state.moderator_stake_minimum @ ProtocolError::InsufficientModeratorStake
    )]
    pub moderator_stake: Account<'info, ModeratorStake>,
    
    #[account(mut)]
    pub ticket: Account<'info, ModTicket>,
    
    /// Optional: Collection account (required if ticket is ContentReport and verdict is true)
    /// CHECK: Collection account - only needed for ContentReport blacklisting
    #[account(mut)]
    pub collection: Option<Account<'info, CollectionState>>,
}

#[derive(Accounts)]
pub struct ResolveCopyrightClaim<'info> {
    #[account(mut)]
    pub moderator: Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        seeds = [b"moderator_stake", moderator.key().as_ref()],
        bump,
        constraint = moderator_stake.is_active @ ProtocolError::InsufficientModeratorStake,
        constraint = moderator_stake.stake_amount >= global_state.moderator_stake_minimum @ ProtocolError::InsufficientModeratorStake
    )]
    pub moderator_stake: Account<'info, ModeratorStake>,
    
    #[account(mut)]
    pub ticket: Account<'info, ModTicket>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: Claim vault token account (source of funds)
    #[account(
        mut,
        constraint = claim_vault.key() == collection.claim_vault @ ProtocolError::Unauthorized
    )]
    pub claim_vault: UncheckedAccount<'info>,

    /// CHECK: Claimant's token account (destination for claim vault tokens)
    #[account(mut)]
    pub claimant_token_account: UncheckedAccount<'info>,

    /// Collection token mint (for transfer_checked)
    pub collection_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn create_ticket(
    ctx: Context<CreateTicket>, 
    target_id: String, 
    ticket_type: TicketType,
    reason: String,
    claim_indices: Vec<u16>,
) -> Result<()> {
    require!(target_id.len() <= crate::state::MAX_ID_LEN, ProtocolError::StringTooLong);
    require!(reason.len() <= crate::state::MAX_REASON_LEN, ProtocolError::StringTooLong);
    
    // ⚠️ SECURITY: For CopyrightClaim tickets, verify the claim deadline hasn't passed
    // This prevents creating tickets after the deadline, but once created, tickets remain
    // resolvable even if the deadline passes during moderator deliberation.
    if ticket_type == TicketType::CopyrightClaim {
        let collection = ctx.accounts.collection.as_ref()
            .ok_or(ProtocolError::Unauthorized)?;
        let clock = &ctx.accounts.clock;
        
        require!(
            clock.unix_timestamp < collection.claim_deadline,
            ProtocolError::Unauthorized
        );
        
        // Validate indices against collection limits
        for &idx in &claim_indices {
            require!(idx < collection.total_videos, ProtocolError::InvalidAccount);
        }
    }
    
    let ticket = &mut ctx.accounts.ticket;
    let clock = &ctx.accounts.clock;
    
    ticket.reporter = ctx.accounts.reporter.key();
    ticket.target_id = target_id;
    ticket.ticket_type = ticket_type;
    ticket.reason = reason;
    ticket.resolved = false;
    ticket.verdict = false;
    ticket.resolver = None;
    ticket.created_at = clock.unix_timestamp;
    ticket.claim_indices = claim_indices; // Store indices
    ticket.bump = ctx.bumps.ticket;
    Ok(())
}

pub fn resolve_ticket(ctx: Context<ResolveTicket>, verdict: bool) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    
    if ticket.resolved {
        return err!(ProtocolError::TicketAlreadyResolved);
    }

    ticket.resolved = true;
    ticket.verdict = verdict; // true = approved (banned), false = rejected (kept)
    ticket.resolver = Some(ctx.accounts.moderator.key());
    
    // Handle ContentReport: blacklist collection if approved
    if ticket.ticket_type == TicketType::ContentReport && verdict {
        if let Some(collection) = &mut ctx.accounts.collection {
            collection.is_blacklisted = true;
            msg!("ContentReportApproved: Collection {} blacklisted", collection.collection_id);
        } else {
            // Collection not provided - log warning but don't fail
            msg!("ContentReportApproved: Collection blacklisting requested but collection account not provided");
        }
    }
    
    // Log event for Indexer to pick up
    msg!("ModTicketResolved: ID={} Type={:?} Verdict={}", ticket.target_id, ticket.ticket_type, verdict);

    Ok(())
}

/// Resolves a copyright claim by transferring the claim vault tokens to the claimant.
/// This is called when a moderator approves a CopyrightClaim ticket.
/// 
/// ⚠️ SECURITY: Automatically reads the full balance from claim_vault to prevent
/// accidental or malicious partial transfers that would leave dust in the vault.
pub fn resolve_copyright_claim(ctx: Context<ResolveCopyrightClaim>, verdict: bool) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    let collection = &mut ctx.accounts.collection;

    // Verify this is a copyright claim ticket
    require!(
        ticket.ticket_type == TicketType::CopyrightClaim,
        ProtocolError::Unauthorized
    );

    if ticket.resolved {
        return err!(ProtocolError::TicketAlreadyResolved);
    }

    // ⚠️ SECURITY: Deadline check removed from resolution.
    // The deadline is now enforced at ticket creation time (in create_ticket).
    // Once a ticket is created before the deadline, it remains resolvable even if
    // the deadline passes during moderator deliberation. This prevents legitimate
    // claims from being invalidated due to processing delays.

    ticket.resolved = true;
    ticket.verdict = verdict; // true = approved (claimant gets vault), false = rejected
    ticket.resolver = Some(ctx.accounts.moderator.key());

    // If approved, transfer proportional claim vault tokens to claimant
    if verdict {
        // 0. Verify tokens have been minted (claim_vault_initial_amount must be set)
        require!(
            collection.tokens_minted && collection.claim_vault_initial_amount > 0,
            ProtocolError::InvalidFeeConfig
        );
        
        // 1. Verify Claim Indices
        require!(!ticket.claim_indices.is_empty(), ProtocolError::InvalidFeeConfig);
        
        // 2. Check Bitmap for double-claims
        for &video_idx in &ticket.claim_indices {
            let byte_idx = (video_idx / 8) as usize;
            let bit_idx = (video_idx % 8) as u8;
            
            // Check bounds
            require!(byte_idx < collection.claimed_bitmap.len(), ProtocolError::InvalidAccount);
            
            // Check if bit is already set
            let is_claimed = (collection.claimed_bitmap[byte_idx] >> bit_idx) & 1;
            require!(is_claimed == 0, ProtocolError::Unauthorized); // "Already Claimed" error
        }

        // 3. Calculate Proportional Amount
        // Share = (Initial_Vault / Total_Videos) * Claimed_Count
        // Use initial amount to maintain stable value per video
        let count_claimed = ticket.claim_indices.len() as u64;
        let per_video_share = collection.claim_vault_initial_amount
            .checked_div(collection.total_videos as u64)
            .ok_or(ProtocolError::MathOverflow)?;
            
        let payout_amount = per_video_share
            .checked_mul(count_claimed)
            .ok_or(ProtocolError::MathOverflow)?;

        require!(payout_amount > 0, ProtocolError::InsufficientFunds);

        // 4. Update Bitmap (Mark as claimed)
        for &video_idx in &ticket.claim_indices {
            let byte_idx = (video_idx / 8) as usize;
            let bit_idx = (video_idx % 8) as u8;
            collection.claimed_bitmap[byte_idx] |= 1 << bit_idx;
        }

        // 5. Transfer Calculated Amount
        let collection_id = collection.collection_id.clone();
        let collection_bump = ctx.bumps.collection;
        let collection_owner = collection.owner;
        let collection_seeds = [
            b"collection".as_ref(),
            collection_owner.as_ref(),
            collection_id.as_bytes(),
            &[collection_bump],
        ];
        let collection_signer = &[&collection_seeds];
        
        let transfer_ix = TransferChecked {
            from: ctx.accounts.claim_vault.to_account_info(),
            mint: ctx.accounts.collection_mint.to_account_info(),
            to: ctx.accounts.claimant_token_account.to_account_info(),
            authority: ctx.accounts.collection.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(), 
            transfer_ix, 
            collection_signer
        );
        anchor_spl::token_interface::transfer_checked(cpi_ctx, payout_amount, ctx.accounts.collection_mint.decimals)?;
        
        msg!(
            "CopyrightClaimPaid: Collection={} Claimant={} Amount={} Indices={:?}",
            collection_id,
            ticket.reporter,
            payout_amount,
            ticket.claim_indices
        );
    } else {
        msg!(
            "CopyrightClaimRejected: Collection={} Reporter={}",
            collection.collection_id,
            ticket.reporter
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct ResolveCidCensorship<'info> {
    #[account(mut)]
    pub moderator: Signer<'info>,

    #[account(
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        seeds = [b"moderator_stake", moderator.key().as_ref()],
        bump,
        constraint = moderator_stake.is_active @ ProtocolError::InsufficientModeratorStake,
        constraint = moderator_stake.stake_amount >= global_state.moderator_stake_minimum @ ProtocolError::InsufficientModeratorStake
    )]
    pub moderator_stake: Account<'info, ModeratorStake>,
    
    #[account(mut)]
    pub ticket: Account<'info, ModTicket>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    pub clock: Sysvar<'info, Clock>,
}

/// Resolves a CID censorship ticket by censoring a specific CID.
/// This instruction updates the on-chain censored_bitmap and emits blockchain logs/notes for the indexer to pick up.
/// The indexer will use these logs to flag the CID as censored in its database.
pub fn resolve_cid_censorship(
    ctx: Context<ResolveCidCensorship>,
    verdict: bool,
    censored_cid: String,
    video_index: u16,
) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    let collection = &mut ctx.accounts.collection;
    let clock = &ctx.accounts.clock;

    // Verify this is a CID censorship ticket
    require!(
        ticket.ticket_type == TicketType::CidCensorship,
        ProtocolError::Unauthorized
    );

    if ticket.resolved {
        return err!(ProtocolError::TicketAlreadyResolved);
    }

    // Validate the index bounds
    require!(video_index < collection.total_videos, ProtocolError::InvalidAccount);

    ticket.resolved = true;
    ticket.verdict = verdict; // true = approved (censor), false = rejected
    ticket.resolver = Some(ctx.accounts.moderator.key());

    // Get collection info for logging
    let collection_id = collection.collection_id.clone();

    // Calculate byte and bit offsets for bitmap update
    let byte_idx = (video_index / 8) as usize;
    let bit_idx = (video_index % 8) as u8;

    // Ensure bitmap is large enough (safety check, though initialized in create_collection)
    require!(
        byte_idx < collection.censored_bitmap.len(),
        ProtocolError::InvalidAccount
    );

    // Update the bitmap based on verdict
    if verdict {
        // Set the bit (Censor)
        collection.censored_bitmap[byte_idx] |= 1 << bit_idx;
        msg!("Video index {} marked as censored in on-chain bitmap", video_index);
    } else {
        // Clear the bit if verdict is false (Un-censor)
        collection.censored_bitmap[byte_idx] &= !(1 << bit_idx);
        msg!("Video index {} unmarked as censored in on-chain bitmap", video_index);
    }

    // Validate CID string length
    require!(
        censored_cid.len() <= crate::state::MAX_URL_LEN,
        ProtocolError::StringTooLong
    );

    // Emit blockchain event for indexer to pick up (both approved and rejected)
    emit!(CidCensorshipEvent {
        collection_id,
        censored_cid,
        moderator: ctx.accounts.moderator.key(),
        timestamp: clock.unix_timestamp,
        approved: verdict,
        reporter: Some(ticket.reporter),
        video_index,
    });

    Ok(())
}
