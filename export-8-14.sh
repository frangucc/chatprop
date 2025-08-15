#!/bin/bash

# Export today's Discord messages (August 14, 2025)
echo "📅 Exporting Discord messages for August 14, 2025"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Read Discord token from file
DISCORD_TOKEN=$(cat /Users/franckjones/chatprop/.discord-token)

# Export for today (August 14)
CHANNEL_ID="438036112007626761"  # small-caps channel
OUTPUT_DIR="/Users/franckjones/chatprop/exports"

echo "📥 Exporting channel: small-caps"
echo "📅 Date: After 2025-08-14 00:00"

# Using DiscordChatExporter CLI
./DiscordChatExporter-CLI/DiscordChatExporter.Cli export \
    -t "$DISCORD_TOKEN" \
    -c "$CHANNEL_ID" \
    --after "2025-08-14 00:00" \
    --before "2025-08-15 00:00" \
    -f Json \
    -o "$OUTPUT_DIR/small-caps-2025-08-14.json" \
    --markdown false \
    --media false

echo ""
echo "✅ Export complete!"
echo "📂 File saved to: $OUTPUT_DIR/small-caps-2025-08-14.json"
echo ""
echo "Next step: Process the export"
echo "Run: cd discord-viewer && npm run process:exports"
