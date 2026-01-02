use anchor_lang::prelude::*;

declare_id!("3zPs2F67GNWofnpbKSDwy3CmHap8KTVWBPLLXABzQmRv");

#[program]
pub mod solana_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
