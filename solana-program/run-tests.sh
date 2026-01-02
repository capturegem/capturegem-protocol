#!/bin/bash

# CaptureGem Protocol Test Runner
# Uses Surfpool for local Solana validator and Anchor for testing

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
SURFPOOL_PID=""
ANCHOR_PID=""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    
    # Kill surfpool if running
    if [ ! -z "$SURFPOOL_PID" ]; then
        echo "Stopping Surfpool (PID: $SURFPOOL_PID)..."
        kill $SURFPOOL_PID 2>/dev/null || true
        wait $SURFPOOL_PID 2>/dev/null || true
    fi
    
    # Kill anchor test validator if running
    if [ ! -z "$ANCHOR_PID" ]; then
        echo "Stopping Anchor test validator (PID: $ANCHOR_PID)..."
        kill $ANCHOR_PID 2>/dev/null || true
        wait $ANCHOR_PID 2>/dev/null || true
    fi
    
    # Clean up any remaining processes
    pkill -f "surfpool" 2>/dev/null || true
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

# Start surfpool
start_surfpool() {
    echo -e "${YELLOW}Starting Surfpool...${NC}"
    cd "$PROJECT_DIR"
    
    # Start surfpool in background
    surfpool start > /tmp/surfpool.log 2>&1 &
    SURFPOOL_PID=$!
    
    # Wait for surfpool to be ready
    echo "Waiting for Surfpool to initialize..."
    sleep 3
    
    # Check if surfpool is still running
    if ! kill -0 $SURFPOOL_PID 2>/dev/null; then
        echo -e "${RED}Error: Surfpool failed to start${NC}"
        cat /tmp/surfpool.log
        exit 1
    fi
    
    echo -e "${GREEN}Surfpool started (PID: $SURFPOOL_PID)${NC}"
}

# Build the program
build_program() {
    echo -e "${YELLOW}Building Anchor program...${NC}"
    cd "$PROJECT_DIR"
    
    if ! anchor build; then
        echo -e "${RED}Error: Failed to build program${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Build successful${NC}"
}

# Deploy the program
deploy_program() {
    echo -e "${YELLOW}Deploying program to localnet...${NC}"
    cd "$PROJECT_DIR"
    
    if ! anchor deploy; then
        echo -e "${RED}Error: Failed to deploy program${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Deployment successful${NC}"
}

# Run tests
run_tests() {
    echo -e "${YELLOW}Running tests...${NC}"
    cd "$PROJECT_DIR"
    
    # Run all test files
    if ! anchor test --skip-local-validator; then
        echo -e "${RED}Error: Tests failed${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}All tests passed!${NC}"
}

# Main execution
main() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}CaptureGem Protocol Test Runner${NC}"
    echo -e "${GREEN}========================================${NC}\n"
    
    # Check prerequisites
    echo "Checking prerequisites..."
    check_solana
    check_anchor
    check_surfpool
    echo -e "${GREEN}All prerequisites met${NC}\n"
    
    # Start surfpool
    start_surfpool
    
    # Build and deploy
    build_program
    deploy_program
    
    # Run tests
    echo ""
    run_tests
    
    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}Test execution complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
}

# Run main function
main
