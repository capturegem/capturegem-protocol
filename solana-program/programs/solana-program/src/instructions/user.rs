use anchor_lang::prelude::*;
use anchor_spl::{
    token::{self, InitializeMint as TokenInitializeMint},
    token_2022::{self, InitializeMint as Token2022InitializeMint},
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

    // Create and initialize mint account if needed
    // The mint account needs to exist and be initialized before we can use it
    let mint_info = ctx.accounts.mint.to_account_info();
    
    // Check if mint is already initialized by checking if account has data and is owned by token program
    let is_initialized = mint_info.lamports() > 0 
        && *mint_info.owner == ctx.accounts.token_program.key()
        && mint_info.data_len() >= 82;
    
    if !is_initialized {
        // Create mint account if it doesn't exist
        if mint_info.lamports() == 0 {
            // Account doesn't exist, create it
            // Standard mint account size is 82 bytes (works for both Token and Token-2022)
            let mint_space = 82u64;
            let rent = Rent::get()?;
            let rent_lamports = rent.minimum_balance(mint_space as usize);
            
            anchor_lang::solana_program::program::invoke(
                &anchor_lang::solana_program::system_instruction::create_account(
                    &ctx.accounts.owner.key(),
                    &mint_info.key(),
                    rent_lamports,
                    mint_space,
                    &ctx.accounts.token_program.key(),
                ),
                &[
                    ctx.accounts.owner.to_account_info(),
                    mint_info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        // Initialize Mint
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

        // Initialize mint via CPI - determine which token program to use
        let token_program_id = ctx.accounts.token_program.key();
        let token_2022_program_id = anchor_spl::token_2022::ID;
        
        if token_program_id == token_2022_program_id {
            // Use Token-2022 program
            let cpi_accounts_mint = Token2022InitializeMint {
                mint: ctx.accounts.mint.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            };
            let cpi_ctx_mint = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_mint,
                signer
            );
            token_2022::initialize_mint(cpi_ctx_mint, 6, &collection.key(), None)?;
        } else {
            // Use standard Token program
            let cpi_accounts_mint = TokenInitializeMint {
                mint: ctx.accounts.mint.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            };
            let cpi_ctx_mint = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_mint,
                signer
            );
            token::initialize_mint(cpi_ctx_mint, 6, &collection.key(), None)?;
        }
    }

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