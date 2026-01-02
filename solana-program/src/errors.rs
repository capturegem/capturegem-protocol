// solana-program/programs/solana-program/src/errors.rs
use anchor_lang::prelude::*;

#[error_code]
pub enum CaptureGemError {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
    #[msg("The collection has reached its maximum video limit.")]
    MaxVideoLimitReached,
    #[msg("Insufficient funds to mint View Rights.")]
    InsufficientFunds,
    #[msg("View Rights are currently valid and do not need renewal.")]
    ViewRightsAlreadyActive,
    #[msg("Pinner bond is not eligible for rewards yet.")]
    PinnerClaimTooEarly,
    #[msg("Invalid Oracle Price Feed.")]
    InvalidOracleFeed,
    #[msg("Arithmetic overflow.")]
    Overflow,
    #[msg("User profile already initialized.")]
    UserAlreadyExists,
    #[msg("Moderator stake is too low.")]
    InsufficientStake,
    #[msg("Ticket already resolved.")]
    TicketAlreadyResolved,
}
