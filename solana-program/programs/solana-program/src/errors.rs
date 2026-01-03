use anchor_lang::prelude::*;

#[error_code]
pub enum ProtocolError {
    #[msg("User is not authorized to perform this action.")]
    Unauthorized,
    #[msg("String length exceeds maximum allowed limit.")]
    StringTooLong,
    #[msg("Invalid fee configuration.")]
    InvalidFeeConfig,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("No shares found for reward distribution.")]
    NoShares,
    #[msg("Price oracle data is stale or invalid.")]
    InvalidOraclePrice,
    #[msg("Insufficient funds provided.")]
    InsufficientFunds,
    #[msg("Ticket already resolved.")]
    TicketAlreadyResolved,
    #[msg("Insufficient moderator stake.")]
    InsufficientModeratorStake,
    #[msg("Collection not found.")]
    CollectionNotFound,
    #[msg("View rights expired.")]
    ViewRightsExpired,
    #[msg("Performer escrow not found.")]
    PerformerEscrowNotFound,
    #[msg("User account not initialized.")]
    UserAccountNotInitialized,
    #[msg("Escrow has expired (24 hours passed).")]
    EscrowExpired,
    #[msg("Escrow has not expired yet (cannot burn).")]
    EscrowNotExpired,
    #[msg("Insufficient initial liquidity provided. Creator must provide minimum CAPGM to pair with collection tokens.")]
    InsufficientInitialLiquidity,
}