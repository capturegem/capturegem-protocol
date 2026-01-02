// solana-program/programs/solana-program/src/instructions/video.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ProtocolError;

#[derive(Accounts)]
#[instruction(video_id: String, root_cid: String)]
pub struct UploadVideo<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection", collection.owner.as_ref(), collection.collection_id.as_bytes()],
        bump,
        constraint = collection.owner == owner.key() @ ProtocolError::Unauthorized
    )]
    pub collection: Account<'info, CollectionState>,

    #[account(
        init,
        payer = owner,
        space = VideoState::MAX_SIZE,
        seeds = [b"video", collection.key().as_ref(), video_id.as_bytes()],
        bump
    )]
    pub video: Account<'info, VideoState>,

    /// CHECK: Optional performer wallet for fee distribution
    pub performer_wallet: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn upload_video(
    ctx: Context<UploadVideo>,
    video_id: String,
    root_cid: String,
) -> Result<()> {
    require!(
        video_id.len() <= MAX_ID_LEN,
        ProtocolError::StringTooLong
    );
    require!(
        root_cid.len() <= MAX_URL_LEN,
        ProtocolError::StringTooLong
    );

    let collection = &mut ctx.accounts.collection;

    // Check video limit
    require!(
        collection.video_count < collection.max_video_limit,
        ProtocolError::VideoLimitExceeded
    );

    // Store collection key before mutable borrow
    let collection_key = collection.key();
    
    // Initialize video state
    let video = &mut ctx.accounts.video;
    video.collection = collection_key;
    video.video_id = video_id;
    video.root_cid = root_cid;
    video.performer_wallet = ctx.accounts.performer_wallet
        .as_ref()
        .map(|acc| acc.key());
    video.uploaded_at = ctx.accounts.clock.unix_timestamp;
    video.bump = ctx.bumps.video;

    // Increment video count
    collection.video_count = collection.video_count
        .checked_add(1)
        .ok_or(ProtocolError::MathOverflow)?;

    // Initialize or update PerformerEscrow if performer_wallet is provided
    if ctx.accounts.performer_wallet.is_some() {
        // In production: Initialize PerformerEscrow PDA if it doesn't exist
        // For now, we just track it in the video state
    }

    msg!("VideoUploaded: Collection={} VideoID={}", collection.collection_id, video.video_id);

    Ok(())
}
