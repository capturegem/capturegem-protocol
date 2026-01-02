// solana-program/programs/solana-program/src/instructions/mod.rs
pub mod admin;
pub mod user;
pub mod access;
pub mod pinner;
pub mod treasury;
pub mod moderation;

pub use admin::*;
pub use user::*;
pub use access::*;
pub use pinner::*;
pub use treasury::*;
pub use moderation::*;
