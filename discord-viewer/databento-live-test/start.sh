#!/bin/bash

# Load environment variables from parent directory's .env.local
if [ -f "../.env.local" ]; then
    export $(cat ../.env.local | grep -v '^#' | xargs)
fi

# Set default values if not in env
export DATABENTO_DATASET="${DATABENTO_DATASET:-EQUS.MINI}"
export RUST_LOG="${RUST_LOG:-info}"

# Start the service
cargo run
