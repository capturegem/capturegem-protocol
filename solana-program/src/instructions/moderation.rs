// solana-program/programs/solana-program/src/instructions/moderation.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

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
    
    // Log event for Indexer to pick up
    msg!("ModTicketResolved: ID={} Type={:?} Verdict={}", ticket.target_id, ticket.ticket_type, verdict);

    Ok(())
}
