use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterHost<'info> {
    #[account(mut)]
    pub pinner: Signer<'info>,
    
    #[account(
        mut, 
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        init,
        payer = pinner,
        space = 8 + 32 + 32 + 1, // 8 (discriminator) + 32 (collection) + 32 (pinner) + 1 (is_active)
        seeds = [b"host_bond", pinner.key().as_ref(), collection.key().as_ref()],
        bump
    )]
    pub pinner_state: Account<'info, PinnerState>,

    pub system_program: Program<'info, System>,
}

pub fn register_collection_host(ctx: Context<RegisterHost>) -> Result<()> {
    let pinner_state = &mut ctx.accounts.pinner_state;
    let collection = &ctx.accounts.collection;

    pinner_state.collection = collection.key();
    pinner_state.pinner = ctx.accounts.pinner.key();
    pinner_state.is_active = true;

    // Note: Pinners no longer receive rewards via a separate claiming mechanism.
    // Pinners are paid directly when purchasers release escrow funds to peers
    // via the release_escrow instruction in access.rs.

    Ok(())
}