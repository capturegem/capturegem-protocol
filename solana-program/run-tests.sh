#!/bin/bash

# ============================================================================
# DEPRECATED: This script is deprecated. Use npm scripts instead:
#   - npm run test:surfpool  (uses external surfpool)
#   - npm run test:anchor    (uses anchor's built-in validator)
# ============================================================================
#
# CaptureGem Protocol Test Runner
# Uses Surfpool for local Solana validator and Anchor for testing

set -e  # Exit on error

# Reset terminal state at script start
if [ -t 1 ]; then
    # We're in a terminal, reset any lingering escape sequences
    printf "\033[0m\033[K"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color
RESET='\033[0m\033[K' # Reset and clear to end of line

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
SURFPOOL_PID=""
ANCHOR_PID=""
SURFPOOL_STARTED_BY_SCRIPT=false
USE_SURFPOOL=true  # Default to using surfpool, can be overridden by argument

# Helper function to print clean messages
# This ensures we reset terminal state and flush output properly
print_msg() {
    # Reset terminal state and move to beginning of line
    printf "\r${RESET}"
    # Print the message and flush
    printf "%s\n" "$1"
    # Ensure output is flushed
    exec 1>&1
}

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    
    # Only kill surfpool if we started it
    if [ "$SURFPOOL_STARTED_BY_SCRIPT" = true ] && [ ! -z "$SURFPOOL_PID" ]; then
        echo "Stopping Surfpool (PID: $SURFPOOL_PID)..."
        kill $SURFPOOL_PID 2>/dev/null || true
        wait $SURFPOOL_PID 2>/dev/null || true
    elif [ "$SURFPOOL_STARTED_BY_SCRIPT" = false ] && [ ! -z "$SURFPOOL_PID" ]; then
        echo "Leaving existing Surfpool instance running (PID: $SURFPOOL_PID)..."
    fi
    
    # Kill anchor test validator if running
    if [ ! -z "$ANCHOR_PID" ]; then
        echo "Stopping Anchor test validator (PID: $ANCHOR_PID)..."
        kill $ANCHOR_PID 2>/dev/null || true
        wait $ANCHOR_PID 2>/dev/null || true
    fi
    
    # Only clean up processes we started
    if [ "$SURFPOOL_STARTED_BY_SCRIPT" = true ]; then
        pkill -f "surfpool" 2>/dev/null || true
    fi
    pkill -f "solana-test-validator" 2>/dev/null || true
    
    echo -e "${GREEN}Cleanup complete${NC}"
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Check if surfpool is installed
check_surfpool() {
    if ! command -v surfpool &> /dev/null; then
        echo -e "${RED}Error: surfpool is not installed${NC}"
        echo "Install it with: cargo install surfpool"
        exit 1
    fi
}

# Check if anchor is installed
check_anchor() {
    if ! command -v anchor &> /dev/null; then
        echo -e "${RED}Error: anchor is not installed${NC}"
        echo "Install it with: cargo install --git https://github.com/coral-xyz/anchor avm --locked --force"
        exit 1
    fi
}

# Check if solana CLI is installed
check_solana() {
    if ! command -v solana &> /dev/null; then
        echo -e "${RED}Error: solana CLI is not installed${NC}"
        echo "Install it from: https://docs.solana.com/cli/install-solana-cli-tools"
        exit 1
    fi
}

# Check if surfpool is already running
check_existing_surfpool() {
    # Check if port 8899 is in use (default Solana RPC port)
    if lsof -i :8899 >/dev/null 2>&1; then
        # Find the surfpool process using port 8899
        EXISTING_PID=$(lsof -ti :8899 | head -n 1)
        if [ ! -z "$EXISTING_PID" ]; then
            # Verify it's actually surfpool
            if ps -p "$EXISTING_PID" -o comm= | grep -q surfpool; then
                SURFPOOL_PID=$EXISTING_PID
                SURFPOOL_STARTED_BY_SCRIPT=false
                return 0
            fi
        fi
    fi
    return 1
}

# Start surfpool
start_surfpool() {
    cd "$PROJECT_DIR"
    
    # Check if surfpool is already running
    if check_existing_surfpool; then
        printf "\r${RESET}${GREEN}Using existing Surfpool instance (PID: $SURFPOOL_PID)${NC}\n"
        return 0
    fi
    
    printf "\r${RESET}${YELLOW}Starting Surfpool...${NC}\n"
    
    # Start surfpool in background
    surfpool start > /tmp/surfpool.log 2>&1 &
    SURFPOOL_PID=$!
    SURFPOOL_STARTED_BY_SCRIPT=true
    
    # Wait for surfpool to be ready
    printf "\r${RESET}Waiting for Surfpool to initialize...\n"
    sleep 3
    
    # Check if surfpool is still running
    if ! kill -0 $SURFPOOL_PID 2>/dev/null; then
        # Check if it failed due to port conflict
        if grep -q "port.*already in use" /tmp/surfpool.log 2>/dev/null; then
            echo -e "${YELLOW}Port conflict detected. Checking for existing instance...${NC}"
            if check_existing_surfpool; then
                printf "\r${RESET}${GREEN}Using existing Surfpool instance (PID: $SURFPOOL_PID)${NC}\n"
                SURFPOOL_STARTED_BY_SCRIPT=false
                return 0
            else
                echo -e "${RED}Error: Surfpool failed to start and no existing instance found${NC}"
                cat /tmp/surfpool.log
                exit 1
            fi
        else
            echo -e "${RED}Error: Surfpool failed to start${NC}"
            cat /tmp/surfpool.log
            exit 1
        fi
    fi
    
    printf "\r${RESET}${GREEN}Surfpool started (PID: $SURFPOOL_PID)${NC}\n"
}

# Build the program
build_program() {
    printf "\r${RESET}${YELLOW}Building Anchor program...${NC}\n"
    cd "$PROJECT_DIR"
    
    # Redirect output to log file to prevent formatting issues with ANSI codes
    # Reset terminal state before running build
    printf "\r${RESET}"
    # Use stdbuf to ensure line-buffered output if available
    if command -v stdbuf >/dev/null 2>&1; then
        if ! stdbuf -oL -eL anchor build > /tmp/anchor-build.log 2>&1; then
            printf "\r${RESET}${RED}Error: Failed to build program${NC}\n"
            echo "Build log:"
            cat /tmp/anchor-build.log
            exit 1
        fi
    else
        if ! anchor build > /tmp/anchor-build.log 2>&1; then
            printf "\r${RESET}${RED}Error: Failed to build program${NC}\n"
            echo "Build log:"
            cat /tmp/anchor-build.log
            exit 1
        fi
    fi
    
    # Ensure the .so file is in the root target/deploy directory
    # Anchor sometimes builds to programs/<program>/target/deploy instead of target/deploy
    PROGRAM_SO="$PROJECT_DIR/programs/solana-program/target/deploy/solana_program.so"
    DEPLOY_SO="$PROJECT_DIR/target/deploy/solana_program.so"
    
    if [ -f "$PROGRAM_SO" ] && [ ! -f "$DEPLOY_SO" ]; then
        echo "Copying program binary to target/deploy..."
        mkdir -p "$PROJECT_DIR/target/deploy"
        cp "$PROGRAM_SO" "$DEPLOY_SO"
    fi
    
    # Verify the file exists
    if [ ! -f "$DEPLOY_SO" ]; then
        printf "\r${RESET}${RED}Error: Program binary not found at $DEPLOY_SO${NC}\n"
        exit 1
    fi
    
    printf "\r${RESET}${GREEN}Build successful${NC}\n"
}

# Deploy the program
deploy_program() {
    printf "\r${RESET}${YELLOW}Deploying program to localnet...${NC}\n"
    cd "$PROJECT_DIR"
    
    # Check if program is already deployed
    PROGRAM_ID="Hwwr37aHr1EddJZmFEXcEnJr94XKrjRotN6mua2tsfaZ"
    if solana program show "$PROGRAM_ID" --url localhost >/dev/null 2>&1; then
        printf "\r${RESET}${YELLOW}Program already deployed. Checking if update is needed...${NC}\n"
        # Get the deployed program's slot
        DEPLOYED_SLOT=$(solana program show "$PROGRAM_ID" --url localhost 2>/dev/null | grep "Last Deployed In Slot" | awk '{print $5}')
        if [ ! -z "$DEPLOYED_SLOT" ]; then
            printf "\r${RESET}${GREEN}Program found at slot $DEPLOYED_SLOT. Skipping deployment.${NC}\n"
            printf "\r${RESET}${YELLOW}To force redeploy, delete the program first or use: anchor deploy -- --skip-build${NC}\n"
            return 0
        fi
    fi
    
    # Deploy the program (may take a while for large programs)
    # Redirect output to log file to prevent formatting issues with ANSI codes
    printf "\r${RESET}${YELLOW}Deploying program (this may take a while for large programs)...${NC}\n"
    # Reset terminal state before running deploy
    printf "\r${RESET}"
    # Use stdbuf to ensure line-buffered output if available
    if command -v stdbuf >/dev/null 2>&1; then
        if ! stdbuf -oL -eL anchor deploy > /tmp/anchor-deploy.log 2>&1; then
            printf "\r${RESET}${RED}Error: Failed to deploy program${NC}\n"
            echo "Deployment log:"
            cat /tmp/anchor-deploy.log
            printf "\r${RESET}${YELLOW}Tip: Large programs may need multiple attempts. Try running the script again.${NC}\n"
            exit 1
        fi
    else
        if ! anchor deploy > /tmp/anchor-deploy.log 2>&1; then
            printf "\r${RESET}${RED}Error: Failed to deploy program${NC}\n"
            echo "Deployment log:"
            cat /tmp/anchor-deploy.log
            printf "\r${RESET}${YELLOW}Tip: Large programs may need multiple attempts. Try running the script again.${NC}\n"
            exit 1
        fi
    fi
    
    printf "\r${RESET}${GREEN}Deployment successful${NC}\n"
}

# Run tests
run_tests() {
    printf "\r${RESET}${YELLOW}Running tests...${NC}\n"
    cd "$PROJECT_DIR"
    
    # Check if program is already deployed to skip deployment
    PROGRAM_ID="Hwwr37aHr1EddJZmFEXcEnJr94XKrjRotN6mua2tsfaZ"
    SKIP_DEPLOY_FLAG=""
    if solana program show "$PROGRAM_ID" --url localhost >/dev/null 2>&1; then
        printf "\r${RESET}${GREEN}Using existing deployed program. Skipping deployment in tests.${NC}\n"
        SKIP_DEPLOY_FLAG="--skip-deploy"
    fi
    
    # Determine if we should skip local validator (use external surfpool)
    SKIP_VALIDATOR_FLAG=""
    if [ "$USE_SURFPOOL" = true ]; then
        SKIP_VALIDATOR_FLAG="--skip-local-validator"
    fi
    
    # Run all test files - let anchor test output directly as it provides useful test output
    # Reset terminal state before running tests
    printf "\r${RESET}"
    # Use stdbuf to ensure line-buffered output if available
    if command -v stdbuf >/dev/null 2>&1; then
        if ! stdbuf -oL -eL anchor test $SKIP_VALIDATOR_FLAG $SKIP_DEPLOY_FLAG; then
            printf "\r${RESET}${RED}Error: Tests failed${NC}\n"
            exit 1
        fi
    else
        if ! anchor test $SKIP_VALIDATOR_FLAG $SKIP_DEPLOY_FLAG; then
            printf "\r${RESET}${RED}Error: Tests failed${NC}\n"
            exit 1
        fi
    fi
    
    printf "\r${RESET}${GREEN}All tests passed!${NC}\n"
}

# Main execution
main() {
    # Parse command line arguments
    if [ "$1" = "--no-surfpool" ] || [ "$1" = "--anchor-validator" ]; then
        USE_SURFPOOL=false
    elif [ "$1" = "--surfpool" ] || [ "$1" = "--external-surfpool" ]; then
        USE_SURFPOOL=true
    fi
    
    # Reset terminal state at start
    printf "\r${RESET}"
    printf "${GREEN}========================================${NC}\n"
    printf "${GREEN}CaptureGem Protocol Test Runner${NC}\n"
    if [ "$USE_SURFPOOL" = true ]; then
        printf "${GREEN}Mode: Using Surfpool (external validator)${NC}\n"
    else
        printf "${GREEN}Mode: Using Anchor's built-in validator${NC}\n"
    fi
    printf "${GREEN}========================================${NC}\n\n"
    
    # Check prerequisites
    printf "\r${RESET}Checking prerequisites...\n"
    check_solana
    check_anchor
    
    # Only check/start surfpool if we're using it
    if [ "$USE_SURFPOOL" = true ]; then
        check_surfpool
        printf "\r${RESET}${GREEN}All prerequisites met${NC}\n\n"
        # Start surfpool
        start_surfpool
    else
        printf "\r${RESET}${GREEN}All prerequisites met${NC}\n\n"
        printf "\r${RESET}${YELLOW}Skipping Surfpool - using Anchor's built-in validator${NC}\n\n"
    fi
    
    # Build the program
    build_program
    
    # Check if we should skip deployment (only relevant when using surfpool)
    if [ "$USE_SURFPOOL" = true ]; then
        PROGRAM_ID="Hwwr37aHr1EddJZmFEXcEnJr94XKrjRotN6mua2tsfaZ"
        SKIP_DEPLOY=false
        if solana program show "$PROGRAM_ID" --url localhost >/dev/null 2>&1; then
            printf "\r${RESET}${GREEN}Program already deployed. Skipping deployment step.${NC}\n"
            printf "\r${RESET}${YELLOW}Note: anchor test will still check deployment but should use existing program.${NC}\n"
            SKIP_DEPLOY=true
        fi
        
        # Deploy only if needed
        if [ "$SKIP_DEPLOY" = false ]; then
            deploy_program
        fi
    fi
    
    # Run tests
    printf "\n"
    run_tests
    
    printf "\n${GREEN}========================================${NC}\n"
    printf "${GREEN}Test execution complete!${NC}\n"
    printf "${GREEN}========================================${NC}\n"
}

# Run main function
main
