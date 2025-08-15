#!/bin/bash

# Daily Discord Export Script
# Uses DiscordChatExporter-CLI to export today's messages

echo "📅 Discord Daily Export - $(date '+%Y-%m-%d')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Configuration
EXPORT_DIR="/Users/franckjones/chatprop/exports"
EXPORTER_PATH="/Users/franckjones/chatprop/DiscordChatExporter-CLI/DiscordChatExporter.Cli"
TOKEN_FILE="/Users/franckjones/chatprop/.discord-token"  # Store token securely

# Date settings
TODAY=$(date '+%Y-%m-%d')
AFTER_DATE="$TODAY 00:00"

# Check if token file exists
if [ ! -f "$TOKEN_FILE" ]; then
    echo "❌ Discord token file not found at $TOKEN_FILE"
    echo "Please create the file with your Discord token"
    exit 1
fi

DISCORD_TOKEN=$(cat "$TOKEN_FILE")

# Channels to export (add your channel IDs here)
CHANNELS=(
    "438036112007626761"  # small-caps
    # Add more channel IDs here
)

echo "🔄 Starting exports for $TODAY..."
echo ""

# Create today's export directory
TODAY_DIR="$EXPORT_DIR/$TODAY"
mkdir -p "$TODAY_DIR"

# Export each channel
for CHANNEL_ID in "${CHANNELS[@]}"; do
    echo "📥 Exporting channel $CHANNEL_ID..."
    
    # Run DiscordChatExporter
    "$EXPORTER_PATH" export \
        -t "$DISCORD_TOKEN" \
        -c "$CHANNEL_ID" \
        --after "$AFTER_DATE" \
        -f Json \
        -o "$TODAY_DIR/channel-$CHANNEL_ID.json" \
        --markdown false \
        --media false
    
    if [ $? -eq 0 ]; then
        echo "✅ Exported channel $CHANNEL_ID"
    else
        echo "❌ Failed to export channel $CHANNEL_ID"
    fi
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Export complete! Files saved to: $TODAY_DIR"
echo ""
echo "Next step: Process the exports"
echo "Run: npm run process:exports"
