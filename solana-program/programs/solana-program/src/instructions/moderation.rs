// solana-program/programs/solana-program/src/instructions/moderation.rs
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, Transfer};
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
}

#[derive(Accounts)]
#[instruction(target_id: String)]
pub struct CreateTicket<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    
    #[account(
        init,
        payer = reporter,
        space = ModTicket::MAX_SIZE,
        seeds = [b"ticket", target_id.as_bytes()],
        bump
    )]
    pub ticket: Account<'info, ModTicket>,
    
    pub system_program: Program<'info, System>,
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

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn create_ticket(
    ctx: Context<CreateTicket>, 
    target_id: String, 
    ticket_type: TicketType,
    reason: String
) -> Result<()> {
    require!(target_id.len() <= crate::state::MAX_ID_LEN, ProtocolError::StringTooLong);
    require!(reason.len() <= crate::state::MAX_REASON_LEN, ProtocolError::StringTooLong);
    
    let ticket = &mut ctx.accounts.ticket;
    ticket.reporter = ctx.accounts.reporter.key();
    ticket.target_id = target_id;
    ticket.ticket_type = ticket_type;
    ticket.reason = reason;
    ticket.resolved = false;
    ticket.verdict = false;
    ticket.resolver = None;
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
/// Note: In production, the vault_amount should be read from the claim_vault token account.
/// For now, it's provided as a parameter to avoid complex deserialization.
pub fn resolve_copyright_claim(ctx: Context<ResolveCopyrightClaim>, verdict: bool, vault_amount: u64) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    let collection = &mut ctx.accounts.collection;
    let clock = &ctx.accounts.clock;

    // Verify this is a copyright claim ticket
    require!(
        ticket.ticket_type == TicketType::CopyrightClaim,
        ProtocolError::Unauthorized
    );

    if ticket.resolved {
        return err!(ProtocolError::TicketAlreadyResolved);
    }

    // Verify claim deadline hasn't passed
    require!(
        clock.unix_timestamp < collection.claim_deadline,
        ProtocolError::Unauthorized
    );

    ticket.resolved = true;
    ticket.verdict = verdict; // true = approved (claimant gets vault), false = rejected
    ticket.resolver = Some(ctx.accounts.moderator.key());

    // If approved, transfer claim vault tokens to claimant
    if verdict {
        require!(vault_amount > 0, ProtocolError::InsufficientFunds);
        
        // Get collection info before mutable borrow
        let collection_id = collection.collection_id.clone();
        let claim_vault_key = collection.claim_vault;
        let collection_owner = collection.owner;
        
        // The claim_vault should be a PDA-owned token account with the collection as authority
        let collection_bump = ctx.bumps.collection;
        let collection_seeds = &[
            b"collection",
            collection_owner.as_ref(),
            collection_id.as_bytes(),
            &[collection_bump],
        ];
        let collection_signer = &[&collection_seeds[..]];
        
        // Transfer tokens from claim_vault to claimant_token_account
        let transfer_ix = Transfer {
            from: ctx.accounts.claim_vault.to_account_info(),
            to: ctx.accounts.claimant_token_account.to_account_info(),
            authority: ctx.accounts.collection.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, transfer_ix, collection_signer);
        anchor_spl::token_interface::transfer(cpi_ctx, vault_amount)?;
        
        msg!(
            "CopyrightClaimApproved: Collection={} Claimant={} Vault={}",
            collection_id,
            ticket.reporter,
            claim_vault_key
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
/// This instruction emits blockchain logs/notes for the indexer to pick up.
/// The indexer will use these logs to flag the CID as censored in its database.
pub fn resolve_cid_censorship(
    ctx: Context<ResolveCidCensorship>,
    verdict: bool,
    censored_cid: String,
) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    let collection = &ctx.accounts.collection;
    let clock = &ctx.accounts.clock;

    // Verify this is a CID censorship ticket
    require!(
        ticket.ticket_type == TicketType::CidCensorship,
        ProtocolError::Unauthorized
    );

    if ticket.resolved {
        return err!(ProtocolError::TicketAlreadyResolved);
    }

    ticket.resolved = true;
    ticket.verdict = verdict; // true = approved (censor), false = rejected
    ticket.resolver = Some(ctx.accounts.moderator.key());

    // Get collection info for logging
    let collection_id = collection.collection_id.clone();

    // If approved, emit blockchain event for indexer to pick up
    if verdict {
        require!(
            censored_cid.len() <= crate::state::MAX_URL_LEN,
            ProtocolError::StringTooLong
        );

        // Emit blockchain event for indexer to pick up
        emit!(CidCensorshipEvent {
            collection_id,
            censored_cid,
            moderator: ctx.accounts.moderator.key(),
            timestamp: clock.unix_timestamp,
            approved: true,
            reporter: Some(ticket.reporter),
        });
    } else {
        // Emit rejection event
        emit!(CidCensorshipEvent {
            collection_id,
            censored_cid,
            moderator: ctx.accounts.moderator.key(),
            timestamp: clock.unix_timestamp,
            approved: false,
            reporter: Some(ticket.reporter),
        });
    }

    Ok(())
}
