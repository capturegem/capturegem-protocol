# CaptureGem Protocol Test Suite

This directory contains comprehensive test cases for the CaptureGem Solana Program.

## Test Structure

Tests are organized into separate files by functionality:

- `protocol.test.ts` - Protocol initialization tests
- `user.test.ts` - User account and collection creation tests
- `access.test.ts` - View rights and access token tests
- `pinner.test.ts` - Pinner registration and reward tests
- `staking.test.ts` - Moderator staking and slashing tests
- `performer.test.ts` - Performer escrow claiming tests
- `moderation.test.ts` - Ticket creation and resolution tests

## Shared Helpers

The `helpers/` directory contains shared utilities:

- `setup.ts` - Test account setup, PDA derivation helpers, and provider configuration
- `constants.ts` - Test constants and configuration values

## Running Tests

### Option 1: Using the Bash Script (Recommended)

The `run-tests.sh` script automates the entire test process:

```bash
./run-tests.sh
```

This script will:
1. Check prerequisites (Solana CLI, Anchor, Surfpool)
2. Start Surfpool local validator
3. Build the Anchor program
4. Deploy to localnet
5. Run all test files
6. Clean up on exit

### Option 2: Manual Execution

1. **Start Surfpool** (in a separate terminal):
   ```bash
   surfpool start
   ```

2. **Build and deploy**:
   ```bash
   anchor build
   anchor deploy
   ```

3. **Run tests**:
   ```bash
   anchor test --skip-local-validator
   ```

   Or using yarn directly:
   ```bash
   yarn run ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.test.ts"
   ```

## Prerequisites

- **Solana CLI**: Install from [solana.com](https://docs.solana.com/cli/install-solana-cli-tools)
- **Anchor**: Install via `cargo install --git https://github.com/coral-xyz/anchor avm --locked --force`
- **Surfpool**: Install via `cargo install surfpool`
- **Node.js & Yarn**: For running TypeScript tests

## Test Coverage

The test suite covers:

- ✅ All 14 program instructions
- ✅ Success cases for each instruction
- ✅ Error cases and validation
- ✅ State verification after operations
- ✅ PDA derivation and account creation
- ✅ Multi-step workflows

## Adding New Tests

When adding tests for new instructions:

1. Create a new test file: `tests/[module].test.ts`
2. Import shared helpers from `helpers/setup.ts` and `helpers/constants.ts`
3. Follow the existing test structure with `describe` and `it` blocks
4. Use the PDA helpers for account derivation
5. Verify state changes after operations

Example:
```typescript
import { expect } from "chai";
import { program, user, setupAccounts } from "./helpers/setup";

describe("New Feature", () => {
  before(async () => {
    await setupAccounts();
  });

  it("Successfully executes new instruction", async () => {
    // Test implementation
  });
});
```
