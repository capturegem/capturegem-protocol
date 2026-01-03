use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

#[derive(Accounts)]
pub struct HarvestFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: Token mint account
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: Source vault containing harvested fees (must be a token account)
    /// This account should have already received fees via HarvestWithheldTokensToMint + WithdrawWithheldTokensFromMint
    #[account(mut)]
    pub fee_vault: UncheckedAccount<'info>,

    /// CHECK: Owner's token account to receive 20% of fees
    #[account(mut)]
    pub owner_token_account: UncheckedAccount<'info>,

    /// CHECK: Performer escrow token account to receive 20% of fees
    #[account(mut)]
    pub performer_escrow_token_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_PERFORMER_ESCROW, collection.key().as_ref()],
        bump
    )]
    pub performer_escrow: Account<'info, PerformerEscrow>,

    #[account(
        seeds = [SEED_GLOBAL_STATE],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// CHECK: Treasury account for staker rewards (10%)
    #[account(mut)]
    pub staker_treasury: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn harvest_fees(ctx: Context<HarvestFees>) -> Result<()> {
    let collection = &mut ctx.accounts.collection;
    let global_state = &ctx.accounts.global_state;

    // 1. Authority check: Only collection owner or protocol admin can harvest fees
    require!(
        ctx.accounts.authority.key() == collection.owner 
        || ctx.accounts.authority.key() == global_state.admin,
        ProtocolError::Unauthorized
    );

    // 2. Read fee_vault balance to calculate actual harvested amount
    // The fee_vault should already contain harvested fees from Token-2022 operations
    // (HarvestWithheldTokensToMint + WithdrawWithheldTokensFromMint should be called separately)
    let fee_vault_account = Account::<TokenAccount>::try_from(&ctx.accounts.fee_vault)
        .map_err(|_| ProtocolError::InsufficientFunds)?;
    
    let harvested_amount = fee_vault_account.amount;
    require!(harvested_amount > 0, ProtocolError::InsufficientFunds);

    // 3. Split fees according to 50/20/20/10 distribution
    let pinner_share = harvested_amount
        .checked_mul(SPLIT_PINNER)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let owner_share = harvested_amount
        .checked_mul(SPLIT_OWNER)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let performer_share = harvested_amount
        .checked_mul(SPLIT_PERFORMER)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let staker_share = harvested_amount
        .checked_mul(SPLIT_STAKERS)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    // Verify the split adds up correctly (accounting for rounding)
    let total_split = pinner_share
        .checked_add(owner_share)
        .and_then(|v| v.checked_add(performer_share))
        .and_then(|v| v.checked_add(staker_share))
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Handle any rounding remainder by adding to pinner share
    let remainder = harvested_amount.saturating_sub(total_split);
    let final_pinner_share = pinner_share.checked_add(remainder).unwrap_or(pinner_share);

    // 4. CRITICAL: Transfer tokens BEFORE updating balances to prevent infinite reward exploit
    // 
    // Security Note: The fee_vault must be a token account owned by the collection PDA
    // (or a treasury PDA derived from the collection) to allow the collection PDA to sign transfers.
    // If the fee_vault is owned by a different authority, the transfers will fail.
    // 
    // Alternative: If fee_vault is owned by the authority, they would need to sign transfers,
    // but this would require the authority to be a signer for each transfer, which is less secure.
    let collection_bump = collection.bump;
    let collection_seeds = &[
        b"collection",
        collection.owner.as_ref(),
        collection.collection_id.as_bytes(),
        &[collection_bump],
    ];
    let signer_seeds = &[&collection_seeds[..]];

    // 4a. Transfer 20% to owner's token account
    if owner_share > 0 {
        let transfer_owner = Transfer {
            from: ctx.accounts.fee_vault.to_account_info(),
            to: ctx.accounts.owner_token_account.to_account_info(),
            authority: ctx.accounts.collection.to_account_info(),
        };
        let cpi_ctx_owner = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_owner,
            signer_seeds,
        );
        anchor_spl::token_interface::transfer(cpi_ctx_owner, owner_share)?;
    }

    // 4b. Transfer 20% to performer escrow token account
    if performer_share > 0 {
        let transfer_performer = Transfer {
            from: ctx.accounts.fee_vault.to_account_info(),
            to: ctx.accounts.performer_escrow_token_account.to_account_info(),
            authority: ctx.accounts.collection.to_account_info(),
        };
        let cpi_ctx_performer = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_performer,
            signer_seeds,
        );
        anchor_spl::token_interface::transfer(cpi_ctx_performer, performer_share)?;
    }

    // 4c. Transfer 10% to staker treasury
    if staker_share > 0 {
        let transfer_staker = Transfer {
            from: ctx.accounts.fee_vault.to_account_info(),
            to: ctx.accounts.staker_treasury.to_account_info(),
            authority: ctx.accounts.collection.to_account_info(),
        };
        let cpi_ctx_staker = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_staker,
            signer_seeds,
        );
        anchor_spl::token_interface::transfer(cpi_ctx_staker, staker_share)?;
    }

    // 4d. The remaining 50% stays in fee_vault for pinner rewards (or can be transferred to a pinner reward pool)
    // For now, we track it in reward_pool_balance. The actual tokens remain in fee_vault
    // and will be distributed when pinners claim rewards.

    // 5. Only AFTER successful transfers, update CollectionState reward balances
    // This ensures balances match actual token transfers, preventing infinite reward exploit
    
    // 50% to Pinners (distributed via MasterChef algorithm)
    if collection.total_shares > 0 && final_pinner_share > 0 {
        let precision = REWARD_PRECISION;
        let reward_added = (final_pinner_share as u128)
            .checked_mul(precision)
            .ok_or(ProtocolError::MathOverflow)?
            .checked_div(collection.total_shares as u128)
            .ok_or(ProtocolError::MathOverflow)?;

        collection.acc_reward_per_share = collection.acc_reward_per_share
            .checked_add(reward_added)
            .ok_or(ProtocolError::MathOverflow)?;
    }
    
    // Update reward pool balance (tokens remain in fee_vault for pinner claims)
    collection.reward_pool_balance = collection.reward_pool_balance
        .checked_add(final_pinner_share)
        .ok_or(ProtocolError::MathOverflow)?;

    // 20% to Owner (already transferred, just track for accounting)
    collection.owner_reward_balance = collection.owner_reward_balance
        .checked_add(owner_share)
        .ok_or(ProtocolError::MathOverflow)?;

    // 20% to Performer Escrow (already transferred, just track for accounting)
    let performer_escrow = &mut ctx.accounts.performer_escrow;
    performer_escrow.balance = performer_escrow.balance
        .checked_add(performer_share)
        .ok_or(ProtocolError::MathOverflow)?;

    // 10% to Stakers (already transferred, just track for accounting)
    collection.staker_reward_balance = collection.staker_reward_balance
        .checked_add(staker_share)
        .ok_or(ProtocolError::MathOverflow)?;

    msg!(
        "FeesHarvested: Collection={} Amount={} PinnerShare={} OwnerShare={} PerformerShare={} StakerShare={}",
        collection.collection_id,
        harvested_amount,
        final_pinner_share,
        owner_share,
        performer_share,
        staker_share
    );

    Ok(())
}