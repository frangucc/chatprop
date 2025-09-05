# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChatProp is a Discord message monitoring and stock ticker analysis system that extracts and tracks stock symbols mentioned in Discord channels. It consists of three main components:

1. **Discord Export System**: Uses DiscordChatExporter-CLI for safe message export
2. **Processing & Analysis**: Node.js backend for ticker extraction and database storage  
3. **Web Interface**: Next.js frontend with real-time updates via WebSocket

## Architecture

### Core Components

- **discord-viewer/**: Main Next.js application with processing scripts
- **discord-monitor/**: Legacy selfbot monitor (deprecated in favor of exports)
- **databento-live-test/**: Rust service for live stock price data via Databento API
- **exports/**: Directory storing daily Discord message exports in JSON format

### Database Schema

Uses PostgreSQL (Neon) with these key tables:
- `discord_messages`: Raw message storage
- `ticker_mentions`: Extracted ticker data with confidence scores
- `ticker_daily_stats`: Aggregated daily statistics  
- `ticker_blacklist`: Filter for false positives (HOLD, JUST, etc.)

## Development Commands

### Daily Workflow (Recommended)
```bash
# Export today's Discord messages (safe, no ban risk)
./export-today.sh
# OR via npm
npm run export:today

# Process exports into database
cd discord-viewer
npm run process:exports

# Start development server with WebSocket support
npm run dev
```

### Development Environment
```bash
# Start all services (exports, processing, servers)
scripts/manage.sh start

# Stop all services
scripts/manage.sh stop

# Check service status
scripts/manage.sh status

# Start servers only (skip exports/processing)
scripts/manage.sh start-lite
```

### Individual Services
```bash
# Next.js frontend (port 3000)
cd discord-viewer
npm run dev-next

# Rust price service (port 7878) 
cd discord-viewer/databento-live-test
cargo run

# Custom WebSocket server
cd discord-viewer
node server.js
```

### Database Operations
```bash
cd discord-viewer

# Setup new database
npm run db:setup

# Test database connection
npm run db:test

# View today's ticker stats
npm run stats

# Clean and reprocess today's data
npm run process:clean
```

### Legacy Discord Monitor (NOT RECOMMENDED - Ban Risk)
```bash
cd discord-monitor
npm run pm2:start    # Background service
npm run pm2:logs     # View logs
npm run pm2:stop     # Stop service
```

## Key File Structure

- `export-today.sh`: Main export script using DiscordChatExporter
- `discord-viewer/process-discord-export.js`: Ticker extraction processor
- `discord-viewer/ticker-extractor-v3.js`: Core extraction logic with blacklist
- `discord-viewer/server.js`: WebSocket-enabled Next.js server
- `scripts/manage.sh`: Comprehensive service management
- `DAILY-WORKFLOW.md`: Detailed operational procedures

## Environment Configuration

Required environment files:
- `.discord-token`: Discord user token (600 permissions)
- `discord-viewer/.env.local`: Database URLs and API keys
- `discord-monitor/.env`: Legacy monitor config (if used)

Key environment variables:
```env
DATABASE_URL=postgresql://... (main Neon database)
DATABENTO_API_KEY=... (for live prices)
ANTHROPIC_API_KEY=... (for AI features)
```

## Important Notes

### Security & Best Practices
- Discord token stored in `.discord-token` file (chmod 600)
- DiscordChatExporter is preferred over selfbot monitoring (no ban risk)
- Database uses connection pooling for performance
- Ticker extraction includes smart blacklist filtering

### Processing Pipeline
1. DiscordChatExporter exports messages to `exports/YYYY-MM-DD/`
2. `process-discord-export.js` extracts tickers with confidence scoring
3. Results stored in PostgreSQL with deduplication
4. Frontend displays real-time ticker mentions via WebSocket
5. Rust service provides live price data integration

### Performance Considerations
- New database schema is 20-60x faster than legacy JSONB approach
- Unique constraints prevent duplicate ticker counting
- Smart blacklist prevents false positives on common words
- Batch processing for large export files

## Debugging & Troubleshooting

### Common Issues
- False ticker positives: Add to `ticker_blacklist` table
- Missing messages: Check channel IDs in `export-today.sh`
- High memory usage: Restart services via `scripts/manage.sh`
- Database connection: Test with `npm run db:test`

### Log Locations
- Next.js: Console output
- Rust service: `cargo run` output or `/tmp/rust-live-server.log`
- Legacy monitor: `discord-monitor/monitor.log`, `discord-monitor/error.log`
- PM2 services: `pm2 logs`