# Test Cases Checklist for CaptureGem Protocol

**Date:** Jan 2, 2026  
**Status:** Implementation Required

This document lists all test cases needed for comprehensive coverage of the CaptureGem Solana Program.

## 1. Protocol Initialization (`initialize_protocol`)

### Success Cases
- [x] Successfully initialize protocol with all parameters
- [x] Verify GlobalState PDA is created correctly
- [x] Verify all fields are set (admin, treasury, URLs, mod_stake_min, capgm_mint, fee_basis_points)
- [x] Verify bump is stored correctly

### Error Cases
- [x] Fail if called twice (already initialized)
- [x] Fail if indexer_url exceeds MAX_URL_LEN
- [x] Fail if registry_url exceeds MAX_URL_LEN

## 2. User Account (`initialize_user_account`)

### Success Cases
- [x] Successfully initialize user account with IPNS key
- [x] Verify UserAccount PDA is created
- [x] Verify ipns_key is stored correctly
- [x] Verify is_online defaults to false
- [x] Verify bump is stored

### Error Cases
- [x] Fail if ipns_key exceeds MAX_IPNS_KEY_LEN
- [x] Fail if called twice for same user (already initialized)

## 3. Collection Creation (`create_collection`)

### Success Cases
- [x] Successfully create collection with all parameters
- [x] Verify CollectionState PDA is created with correct seeds
- [x] Verify Token-2022 mint is created with 6 decimals
- [x] Verify 10% transfer fee is configured
- [x] Verify all reward balances initialize to 0
- [x] Verify max_video_limit and video_count are set correctly
- [x] Verify oracle_feed is stored

### Error Cases
- [x] Fail if collection_id exceeds MAX_ID_LEN
- [x] Fail if name exceeds MAX_NAME_LEN
- [x] Fail if content_cid exceeds MAX_URL_LEN
- [x] Fail if max_video_limit is 0
- [x] Fail if collection_id already exists for same owner

## 4. Video Upload (`upload_video`)

### Success Cases
- [x] Successfully upload video to collection
- [x] Verify VideoState PDA is created
- [x] Verify video_count is incremented
- [x] Verify performer_wallet is linked (if provided)
- [x] Verify uploaded_at timestamp is set

### Error Cases
- [x] Fail if video_id exceeds MAX_ID_LEN
- [x] Fail if root_cid exceeds MAX_URL_LEN
- [x] Fail if caller is not collection owner
- [x] Fail if video_count >= max_video_limit
- [x] Fail if collection doesn't exist

## 5. Buy Access Token (`buy_access_token`)

### Success Cases
- [x] Successfully mint ViewRights when user has sufficient token value
- [x] Verify ViewRights PDA is created with correct seeds
- [x] Verify expires_at is set to 90 days from now
- [x] Successfully renew existing ViewRights (extend from current time)
- [x] Verify oracle price calculation accounts for 6 decimals

### Error Cases
- [x] Fail if user has insufficient token balance
- [x] Fail if token value in USD < access_threshold_usd
- [x] Fail if oracle price is invalid (0 or negative)
- [x] Fail if collection doesn't exist
- [x] Fail if user has 0 token balance

## 6. Pinner Registration (`register_collection_host`)

### Success Cases
- [x] Successfully register pinner for collection
- [x] Verify PinnerState PDA is created with correct seeds
- [x] Verify last_audit_pass is set to current timestamp
- [x] Verify is_active is set to true
- [x] Verify shares are set (default 1)
- [x] Verify reward_debt is calculated correctly
- [x] Verify collection.total_shares is incremented

### Error Cases
- [x] Fail if collection doesn't exist
- [x] Fail if pinner already registered for same collection

## 7. Submit Audit Result (`submit_audit_result`)

### Success Cases
- [x] Successfully submit successful audit
- [x] Verify last_audit_pass is updated
- [x] Verify is_active remains true on success
- [x] Successfully submit failed audit
- [x] Verify is_active is set to false on failure

### Error Cases
- [x] Fail if pinner_state doesn't exist
- [x] Fail if authority is not a valid auditor (future: add authority check)

## 8. Claim Rewards (`claim_rewards`)

### Success Cases
- [x] Successfully claim rewards when audit window is valid
- [x] Verify pending rewards calculated correctly (MasterChef formula)
- [x] Verify reward_pool_balance is decremented
- [x] Verify reward_debt is updated
- [x] Verify SOL is transferred to pinner

### Error Cases
- [x] Fail if audit window expired (>7 days since last_audit_pass)
- [x] Fail if pinner is not active
- [x] Fail if no pending rewards
- [x] Fail if reward_pool_balance is insufficient
- [x] Fail if pinner_state doesn't exist

## 9. Harvest Fees (`harvest_fees`)

### Success Cases
- [x] Successfully harvest fees and split 50/20/20/10
- [x] Verify 50% goes to reward_pool_balance
- [x] Verify 20% goes to owner_reward_balance
- [x] Verify 20% goes to performer_escrow.balance
- [x] Verify 10% goes to staker_reward_balance
- [x] Verify acc_reward_per_share is updated if total_shares > 0
- [x] Verify rounding remainder goes to pinner share

### Error Cases
- [x] Fail if collection doesn't exist
- [x] Fail if harvested_amount is 0

## 10. Stake Moderator (`stake_moderator`)

### Success Cases
- [x] Successfully stake CAPGM as moderator
- [x] Verify ModeratorStake PDA is created
- [x] Verify stake_amount is stored correctly
- [x] Verify is_active is set to true
- [x] Successfully add additional stake to existing moderator

### Error Cases
- [x] Fail if stake_amount < moderator_stake_minimum
- [x] Fail if moderator doesn't have sufficient CAPGM balance
- [x] Fail if GlobalState doesn't exist

## 11. Slash Moderator (`slash_moderator`)

### Success Cases
- [x] Successfully slash moderator (admin only)
- [x] Verify stake_amount is set to 0
- [x] Verify is_active is set to false
- [x] Verify slash_count is incremented

### Error Cases
- [x] Fail if caller is not admin
- [x] Fail if moderator_stake doesn't exist
- [x] Fail if GlobalState doesn't exist

## 12. Claim Performer Escrow (`claim_performer_escrow`)

### Success Cases
- [x] Successfully claim performer escrow
- [x] Verify balance is transferred
- [x] Verify escrow balance is reset to 0

### Error Cases
- [x] Fail if performer_wallet doesn't match signer
- [x] Fail if escrow balance is 0
- [x] Fail if PerformerEscrow doesn't exist
- [x] Fail if collection doesn't exist

## 13. Create Ticket (`create_ticket`)

### Success Cases
- [x] Successfully create ContentReport ticket
- [x] Successfully create DuplicateReport ticket
- [x] Successfully create PerformerClaim ticket
- [x] Verify ModTicket PDA is created with correct seeds
- [x] Verify all fields are set correctly
- [x] Verify resolved defaults to false

### Error Cases
- [x] Fail if target_id exceeds MAX_ID_LEN
- [x] Fail if reason exceeds MAX_REASON_LEN
- [x] Fail if ticket already exists for same target_id

## 14. Resolve Ticket (`resolve_ticket`)

### Success Cases
- [x] Successfully resolve ticket with verdict=true (approved/banned)
- [x] Successfully resolve ticket with verdict=false (rejected/kept)
- [x] Verify resolved is set to true
- [x] Verify verdict is stored
- [x] Verify resolver is set to moderator pubkey
- [x] Verify event is emitted for Indexer

### Error Cases
- [x] Fail if ticket is already resolved
- [x] Fail if moderator doesn't have sufficient stake
- [x] Fail if moderator is not active
- [x] Fail if ticket doesn't exist
- [x] Fail if GlobalState doesn't exist

## Integration Tests

### Multi-Step Workflows
- [x] Complete flow: Initialize protocol → Create user → Create collection → Upload video → Buy access
- [x] Complete pinner flow: Register → Submit audit → Claim rewards
- [x] Complete moderation flow: Create ticket → Stake moderator → Resolve ticket
- [x] Complete fee flow: Create collection → Harvest fees → Verify distribution
- [x] Complete performer flow: Upload video with performer → Harvest fees → Claim escrow

### Edge Cases
- [x] Multiple collections per owner
- [x] Multiple videos per collection (up to limit)
- [x] Multiple pinners per collection
- [x] ViewRights renewal before expiration
- [x] ViewRights renewal after expiration
- [x] Multiple tickets for same target
- [x] Moderator slashing and re-staking

## Test Coverage Goals

- **Unit Tests**: Each instruction function
- **Integration Tests**: Multi-step workflows
- **Error Tests**: All error conditions
- **Edge Cases**: Boundary conditions and special scenarios
- **State Verification**: PDA creation, field updates, balance changes

## Test File Structure

```
tests/
├── solana-program.ts (main test file)
├── helpers/
│   ├── setup.ts (test setup utilities)
│   ├── accounts.ts (PDA derivation helpers)
│   └── constants.ts (test constants)
└── suites/
    ├── protocol.test.ts
    ├── user.test.ts
    ├── collection.test.ts
    ├── video.test.ts
    ├── access.test.ts
    ├── pinner.test.ts
    ├── treasury.test.ts
    ├── staking.test.ts
    ├── performer.test.ts
    └── moderation.test.ts
```
