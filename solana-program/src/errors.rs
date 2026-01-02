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
}