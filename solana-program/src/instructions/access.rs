use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

#[derive(Accounts)]
pub struct BuyAccess<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// The payer's Collection Token account (to check balance)
    #[account(
        mut,
        constraint = buyer_token_account.owner == payer.key() @ ProtocolError::Unauthorized,
        constraint = buyer_token_account.mint == collection.mint @ ProtocolError::Unauthorized,
    )]
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// CHECK: Price oracle feed for the Collection Token (Pyth or Switchboard)
    /// Must match the oracle_feed stored in CollectionState
    #[account(
        constraint = oracle_feed.key() == collection.oracle_feed @ ProtocolError::Unauthorized
    )]
    pub oracle_feed: UncheckedAccount<'info>,

    /// ViewRights PDA - will be created or updated
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 32 + 8 + 8, // discriminator + owner + collection + minted_at + expires_at
        seeds = [SEED_VIEW_RIGHT, payer.key().as_ref(), collection.key().as_ref()],
        bump
    )]
    pub view_rights: Account<'info, ViewRights>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn buy_access_token(ctx: Context<BuyAccess>) -> Result<()> {
    let collection = &ctx.accounts.collection;
    let clock = &ctx.accounts.clock;
    let access_threshold_usd_cents = collection.access_threshold_usd; // e.g. 1000 = $10.00

    // 1. Get Collection Token balance from user's token account
    let token_balance = ctx.accounts.buyer_token_account.amount;
    
    if token_balance == 0 {
        return err!(ProtocolError::InsufficientFunds);
    }

    // 2. Get Collection Token price from Oracle (Mock implementation)
    // In production: Use pyth_sdk_solana::load_price_feed_from_account_info
    // or Switchboard's oracle SDK to get the current price
    // For now, we'll use a mock price - in production this would query the oracle_feed account
    let collection_token_price_usd_cents = get_collection_token_price(&ctx.accounts.oracle_feed)?;
    
    if collection_token_price_usd_cents <= 0 {
        return err!(ProtocolError::InvalidOraclePrice);
    }

    // 3. Calculate USD value of user's Collection Token holdings
    // Value = (token_balance * token_price_usd_cents) / (10^decimals)
    // Collection Tokens use 6 decimals
    let decimals_multiplier: u64 = 1_000_000; // 10^6
    let token_value_usd_cents = token_balance
        .checked_mul(collection_token_price_usd_cents)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(decimals_multiplier)
        .ok_or(ProtocolError::MathOverflow)?;

    // 4. Verify user has sufficient USD value to mint access
    require!(
        token_value_usd_cents >= access_threshold_usd_cents,
        ProtocolError::InsufficientFunds
    );

    // 5. Create or renew ViewRights PDA
    let view_rights = &mut ctx.accounts.view_rights;
    let current_timestamp = clock.unix_timestamp;
    
    // Check if this is a renewal (account exists and belongs to this user/collection)
    let is_renewal = view_rights.owner == ctx.accounts.payer.key() 
        && view_rights.collection == collection.key();

    if is_renewal {
        // Renew existing ViewRights (extend validity from now, regardless of expiration)
        view_rights.minted_at = current_timestamp;
        view_rights.expires_at = current_timestamp
            .checked_add(VIEW_RIGHTS_VALIDITY_SECONDS)
            .ok_or(ProtocolError::MathOverflow)?;
    } else {
        // Create new ViewRights (init_if_needed will initialize if account doesn't exist)
        view_rights.owner = ctx.accounts.payer.key();
        view_rights.collection = collection.key();
        view_rights.minted_at = current_timestamp;
        view_rights.expires_at = current_timestamp
            .checked_add(VIEW_RIGHTS_VALIDITY_SECONDS)
            .ok_or(ProtocolError::MathOverflow)?;
    }

    Ok(())
}

/// Helper function to get Collection Token price from oracle
/// Supports both Pyth and Switchboard oracles
fn get_collection_token_price(oracle_feed: &AccountInfo) -> Result<u64> {
    // Try to determine oracle type by checking account data
    // In production, you would:
    // 1. Check if it's a Pyth price feed account
    // 2. Check if it's a Switchboard aggregator account
    // 3. Load the appropriate SDK and fetch price
    
    // Pyth Integration (example):
    // use pyth_solana::load_price_feed_from_account_info;
    // let price_feed = load_price_feed_from_account_info(oracle_feed)?;
    // let price_data = price_feed.get_current_price()?;
    // 
    // // Pyth prices are in fixed-point format with exponent
    // // price = price_data.price * 10^(price_data.expo)
    // // We need to convert to USD cents (multiply by 100)
    // let price_usd = (price_data.price as f64) * 10_f64.powi(price_data.expo);
    // let price_cents = (price_usd * 100.0) as u64;
    // 
    // // Check if price is stale (older than 60 seconds)
    // let current_time = Clock::get()?.unix_timestamp;
    // let price_age = current_time - price_data.publish_time;
    // require!(price_age < 60, ProtocolError::InvalidOraclePrice);
    //
    // Ok(price_cents)
    
    // Switchboard Integration (example):
    // use switchboard_solana::AggregatorAccountData;
    // let aggregator = AggregatorAccountData::new(oracle_feed)?;
    // let result = aggregator.get_result()?;
    // let price_cents = (result.value * 100.0) as u64;
    // Ok(price_cents)
    
    // For now, return a mock price until oracle SDKs are added as dependencies
    // TODO: Add pyth-solana or switchboard-v2 as dependencies in Cargo.toml
    // TODO: Implement actual price fetching based on oracle type
    
    // Mock: Return $0.10 per token (10 cents) - REMOVE IN PRODUCTION
    Ok(10)
}
