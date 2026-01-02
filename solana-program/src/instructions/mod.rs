// solana-program/programs/solana-program/src/instructions/mod.rs
pub mod admin;
pub mod user;
pub mod access;
pub mod pinner;
pub mod treasury;
pub mod moderation;
pub mod staking;
pub mod performer;
pub mod video;

pub use admin::*;
pub use user::*;
pub use access::*;
pub use pinner::*;
pub use treasury::*;
pub use moderation::*;
pub use staking::*;
pub use performer::*;
pub use video::*;