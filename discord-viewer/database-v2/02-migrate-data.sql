-- ============================================
-- DATA MIGRATION SCRIPT
-- Migrates data from old database to new schema
-- ============================================

-- This script assumes you're connected to the NEW database
-- and the OLD database is accessible via foreign data wrapper

-- Step 1: Create foreign data wrapper to old database
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SERVER old_db_server
FOREIGN DATA WRAPPER postgres_fdw
OPTIONS (host 'ep-old-violet-aewo0ts3-pooler.c-2.us-east-2.aws.neon.tech', 
         port '5432', 
         dbname 'neondb');

CREATE USER MAPPING FOR CURRENT_USER
SERVER old_db_server
OPTIONS (user 'neondb_owner', password 'npg_pM1YgZXw8zim');

-- Step 2: Create foreign tables for old data
CREATE SCHEMA old_data;

IMPORT FOREIGN SCHEMA public
LIMIT TO (discord_messages, stocks, ticker_blacklist)
FROM SERVER old_db_server
INTO old_data;

-- Step 3: Migrate authors from messages
INSERT INTO authors (id, username, is_bot, first_seen, last_seen)
SELECT DISTINCT ON (author_id)
    author_id as id,
    author_name as username,
    false as is_bot,
    MIN(timestamp) OVER (PARTITION BY author_id) as first_seen,
    MAX(timestamp) OVER (PARTITION BY author_id) as last_seen
FROM old_data.discord_messages
WHERE author_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Step 4: Migrate guilds and channels (inferred from messages)
INSERT INTO guilds (id, name)
SELECT DISTINCT 
    guild_id,
    guild_name
FROM old_data.discord_messages
WHERE guild_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, guild_id, name, is_monitored)
SELECT DISTINCT
    channel_id,
    guild_id,
    channel_name,
    true
FROM old_data.discord_messages
WHERE channel_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Step 5: Migrate messages
INSERT INTO messages (
    id, channel_id, author_id, content, 
    discord_timestamp, has_attachments, has_embeds
)
SELECT 
    id,
    channel_id,
    author_id,
    content,
    timestamp as discord_timestamp,
    attachments IS NOT NULL AND attachments != '[]' as has_attachments,
    embeds IS NOT NULL AND embeds != '[]' as has_embeds
FROM old_data.discord_messages
ON CONFLICT (id) DO NOTHING;

-- Step 6: Migrate tickers from stocks table
INSERT INTO tickers (symbol, exchange, company_name, is_active)
SELECT DISTINCT
    UPPER(ticker) as symbol,
    COALESCE(exchange, 'UNKNOWN') as exchange,
    ticker as company_name, -- We'll update this later
    is_genuine_stock as is_active
FROM old_data.stocks
WHERE ticker IS NOT NULL
ON CONFLICT (symbol) DO UPDATE SET
    is_active = EXCLUDED.is_active;

-- Step 7: Migrate blacklist
INSERT INTO ticker_blacklist (ticker, reason, category, added_by)
SELECT 
    UPPER(ticker),
    COALESCE(reason, 'Legacy blacklist entry'),
    CASE 
        WHEN context_note ILIKE '%common word%' THEN 'common_word'
        WHEN context_note ILIKE '%false positive%' THEN 'false_positive'
        ELSE 'other'
    END as category,
    COALESCE(added_by, 'legacy')
FROM old_data.ticker_blacklist
ON CONFLICT (ticker) DO NOTHING;

-- Step 8: Migrate ticker detections from stocks table
-- This creates initial detections based on first mentions
INSERT INTO ticker_detections (
    message_id, ticker_symbol, detection_method, 
    confidence_score, detected_text
)
SELECT 
    first_mention_message_id as message_id,
    UPPER(ticker) as ticker_symbol,
    'legacy' as detection_method,
    COALESCE(detection_confidence, 0.5) as confidence_score,
    ticker as detected_text
FROM old_data.stocks
WHERE first_mention_message_id IS NOT NULL
AND EXISTS (SELECT 1 FROM tickers WHERE symbol = UPPER(ticker))
AND EXISTS (SELECT 1 FROM messages WHERE id = first_mention_message_id)
ON CONFLICT (message_id, ticker_symbol, position_in_message) DO NOTHING;

-- Step 9: Generate daily stats from migrated data
SELECT update_daily_ticker_stats(date_trunc('day', NOW())::date);
SELECT update_daily_ticker_stats(date_trunc('day', NOW() - interval '1 day')::date);
SELECT update_daily_ticker_stats(date_trunc('day', NOW() - interval '2 days')::date);

-- Step 10: Update author message counts
UPDATE authors a
SET message_count = (
    SELECT COUNT(*) 
    FROM messages m 
    WHERE m.author_id = a.id
);

-- Step 11: Mark known traders
UPDATE authors
SET is_trader = true
WHERE username IN (
    -- Add your known trader usernames here
    'SniperTrader', 'PumpAlert', 'StockGuru'
    -- This list would come from your knowledge of actual traders
);

-- Clean up foreign data wrapper (optional)
-- DROP SCHEMA old_data CASCADE;
-- DROP USER MAPPING FOR CURRENT_USER SERVER old_db_server;
-- DROP SERVER old_db_server CASCADE;
