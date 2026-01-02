use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{self, InitializeMint},
    token_interface::TokenInterface,
};
use crate::state::*;
use crate::errors::ProtocolError;
use crate::constants::*;

#[derive(Accounts)]
#[instruction(collection_id: String, name: String, content_cid: String, access_threshold_usd: u64, max_video_limit: u32)]
pub struct CreateCollection<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + MAX_ID_LEN + MAX_NAME_LEN + MAX_URL_LEN + 8 + 32 + 4 + 4 + 8 + 8 + 8 + 8 + 8 + 16,
        seeds = [b"collection", owner.key().as_ref(), collection_id.as_bytes()],
        bump
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: Price oracle feed (Pyth or Switchboard) for this Collection Token
    pub oracle_feed: UncheckedAccount<'info>,

    /// CHECK: Token mint account (will be initialized)
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_collection(
    ctx: Context<CreateCollection>,
    collection_id: String,
    name: String,
    content_cid: String,
    access_threshold_usd: u64,
    max_video_limit: u32,
) -> Result<()> {
    require!(collection_id.len() <= MAX_ID_LEN, ProtocolError::StringTooLong);
    require!(name.len() <= MAX_NAME_LEN, ProtocolError::StringTooLong);
    require!(content_cid.len() <= MAX_URL_LEN, ProtocolError::StringTooLong);
    require!(max_video_limit > 0, ProtocolError::InvalidFeeConfig);

    let collection = &mut ctx.accounts.collection;
    collection.owner = ctx.accounts.owner.key();
    collection.mint = ctx.accounts.mint.key();
    collection.collection_id = collection_id;
    collection.name = name;
    collection.content_cid = content_cid;
    collection.access_threshold_usd = access_threshold_usd;
    collection.oracle_feed = ctx.accounts.oracle_feed.key();
    collection.max_video_limit = max_video_limit;
    collection.video_count = 0;
    
    // Initialize reward trackers
    collection.reward_pool_balance = 0;
    collection.owner_reward_balance = 0;
    collection.performer_escrow_balance = 0;
    collection.staker_reward_balance = 0;
    collection.total_shares = 0;
    collection.acc_reward_per_share = 0;

    // Initialize Mint (Standard)
    // Note: Transfer fee config is initialized automatically by Anchor's extensions::transfer_fee_config
    // in the account constraints above. The fee configuration will be set to defaults.
    // To set custom fees, you would need to perform a separate CPI after mint initialization.
    let owner_key = ctx.accounts.owner.key();
    let collection_id_bytes = collection.collection_id.as_bytes();
    let bump = ctx.bumps.collection;
    let seeds = &[
        b"collection",
        owner_key.as_ref(),
        collection_id_bytes,
        &[bump],
    ];
    let signer = &[&seeds[..]];

    // Initialize mint via CPI
    let cpi_accounts_mint = InitializeMint {
        mint: ctx.accounts.mint.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };
    let cpi_ctx_mint = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts_mint,
        signer
    );
    token_2022::initialize_mint(cpi_ctx_mint, 6, &collection.key(), None)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(ipns_key: String)]
pub struct InitializeUserAccount<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = UserAccount::MAX_SIZE,
        seeds = [SEED_USER_ACCOUNT, authority.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_user_account(
    ctx: Context<InitializeUserAccount>,
    ipns_key: String,
) -> Result<()> {
    require!(
        ipns_key.len() <= MAX_IPNS_KEY_LEN,
        ProtocolError::StringTooLong
    );

    let user_account = &mut ctx.accounts.user_account;
    user_account.authority = ctx.accounts.authority.key();
    user_account.ipns_key = ipns_key;
    user_account.is_online = false;
    user_account.bump = ctx.bumps.user_account;

    Ok(())
}