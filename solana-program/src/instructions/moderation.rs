// solana-program/programs/solana-program/src/instructions/moderation.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::CaptureGemError;

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
    pub moderator: Signer<'info>, // Must have stake (check not implemented in this snippet)
    
    #[account(mut)]
    pub ticket: Account<'info, ModTicket>,
}

pub fn create_ticket(ctx: Context<CreateTicket>, target_id: String, reason: String) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    ticket.reporter = ctx.accounts.reporter.key();
    ticket.target_id = target_id;
    ticket.reason = reason;
    ticket.resolved = false;
    ticket.bump = ctx.bumps.ticket;
    Ok(())
}

pub fn resolve_ticket(ctx: Context<ResolveTicket>, verdict: bool) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    
    if ticket.resolved {
        return err!(CaptureGemError::TicketAlreadyResolved);
    }

    ticket.resolved = true;
    ticket.verdict = verdict; // true = banned, false = kept
    
    // Log event for Indexer to pick up
    msg!("ModTicketResolved: ID={} Verdict={}", ticket.target_id, verdict);

    Ok(())
}
