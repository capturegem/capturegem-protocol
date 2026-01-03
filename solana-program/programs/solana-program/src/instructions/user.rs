use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, MintTo};
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

    /// Token mint account (PDA derived from collection)
    #[account(
        init_if_needed,
        payer = owner,
        mint::decimals = 6,
        mint::authority = collection,
        mint::freeze_authority = collection,
        seeds = [b"mint", collection.key().as_ref()],
        bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,

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

    // Mint is automatically created and initialized by Anchor's init constraint
    // The mint authority is set to the collection PDA, which allows the collection
    // to control minting and freezing of tokens

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

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct MintCollectionTokens<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump,
        constraint = collection.owner == creator.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    /// CHECK: The collection token mint (PDA derived from collection)
    #[account(
        mut,
        seeds = [b"mint", collection.key().as_ref()],
        bump
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Creator's token account to receive 10% of minted tokens
    #[account(
        mut,
        constraint = creator_token_account.owner == creator.key() @ ProtocolError::Unauthorized,
        constraint = creator_token_account.mint == mint.key() @ ProtocolError::Unauthorized
    )]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Orca DEX liquidity pool token account (or pool address)
    /// This account will receive 90% of the minted tokens for liquidity provision
    #[account(mut)]
    pub orca_liquidity_pool: UncheckedAccount<'info>,

    /// CHECK: Orca program ID (for CPI calls to Orca DEX)
    /// In production, this should be the official Orca Whirlpool or StableSwap program ID
    pub orca_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn mint_collection_tokens(
    ctx: Context<MintCollectionTokens>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ProtocolError::InvalidFeeConfig);

    let collection = &ctx.accounts.collection;
    let mint = &ctx.accounts.mint;
    let creator = &ctx.accounts.creator;

    // Verify the mint matches the collection's mint
    require!(
        mint.key() == collection.mint,
        ProtocolError::Unauthorized
    );

    // Calculate distribution: 10% to creator, 90% to Orca
    let creator_amount = amount
        .checked_mul(10)
        .ok_or(ProtocolError::MathOverflow)?
        .checked_div(100)
        .ok_or(ProtocolError::MathOverflow)?;

    let orca_amount = amount
        .checked_sub(creator_amount)
        .ok_or(ProtocolError::MathOverflow)?;

    // Verify the split is correct (accounting for rounding)
    let total_distributed = creator_amount
        .checked_add(orca_amount)
        .ok_or(ProtocolError::MathOverflow)?;
    
    // Handle any rounding remainder by adjusting creator amount
    let remainder = amount.saturating_sub(total_distributed);
    let final_creator_amount = creator_amount
        .checked_add(remainder)
        .unwrap_or(creator_amount);
    let final_orca_amount = amount
        .checked_sub(final_creator_amount)
        .ok_or(ProtocolError::MathOverflow)?;

    // 1. Mint tokens to creator and Orca
    // Since the mint authority is the collection PDA, we use CPI to mint
    let collection_bump = ctx.bumps.collection;
    let seeds = &[
        b"collection",
        collection.owner.as_ref(),
        collection.collection_id.as_bytes(),
        &[collection_bump],
    ];
    let signer = &[&seeds[..]];

    // Mint tokens to creator's account (10%)
    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.creator_token_account.to_account_info(),
        authority: ctx.accounts.collection.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    anchor_spl::token_interface::mint_to(cpi_ctx, final_creator_amount)?;

    // 2. Mint remaining tokens to Orca liquidity pool (90%)
    // Note: In production, this would involve:
    // - Creating or finding an Orca Whirlpool/StableSwap pool
    // - Providing both sides of the liquidity pair (Collection Token + CAPGM)
    // - Using CPI to call Orca's program instructions
    // For now, we mint directly to the provided Orca account
    // TODO: Implement full Orca DEX integration with proper pool creation and liquidity provision
    
    let orca_cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.orca_liquidity_pool.to_account_info(),
        authority: ctx.accounts.collection.to_account_info(),
    };
    let orca_cpi_program = ctx.accounts.token_program.to_account_info();
    let orca_cpi_ctx = CpiContext::new_with_signer(orca_cpi_program, orca_cpi_accounts, signer);
    anchor_spl::token_interface::mint_to(orca_cpi_ctx, final_orca_amount)?;

    // 3. In production, after minting to Orca pool account, you would:
    //    - Call Orca's initialize_pool or add_liquidity instruction via CPI
    //    - Provide CAPGM tokens as the other side of the pair
    //    - Handle LP token receipt and storage
    // Example structure (pseudo-code):
    // let orca_ix = orca::instruction::AddLiquidity {
    //     pool: orca_pool_account,
    //     token_a: collection_token_account,
    //     token_b: capgm_token_account,
    //     amount_a: final_orca_amount,
    //     amount_b: capgm_amount,
    //     ...
    // };
    // invoke_signed(&orca_ix, &orca_accounts, &signer_seeds)?;

    msg!(
        "CollectionTokensMinted: Collection={} Creator={} CreatorAmount={} OrcaAmount={}",
        collection.collection_id,
        creator.key(),
        final_creator_amount,
        final_orca_amount
    );

    Ok(())
}