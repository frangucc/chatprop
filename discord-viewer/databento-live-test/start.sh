#!/bin/bash

# Load environment variables from discord-viewer/.env.local
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"

if [ -f "$ENV_FILE" ]; then
    export $(cat "$ENV_FILE" | grep -v '^#' | xargs)
    echo "Loaded environment from $ENV_FILE"
else
    echo "Warning: $ENV_FILE not found"
fi

# Set default values if not in env
export DATABENTO_DATASET="${DATABENTO_DATASET:-EQUS.MINI}"
export RUST_LOG="${RUST_LOG:-info}"

# Change to the Rust project directory and start the service
cd "$SCRIPT_DIR"
cargo run
