-- ============================================
-- CHATPROP DATABASE SCHEMA V2
-- Clean, normalized, and optimized architecture
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search

-- ============================================
-- CORE TABLES
-- ============================================

-- Discord servers/guilds
CREATE TABLE guilds (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Discord channels
CREATE TABLE channels (
    id VARCHAR(50) PRIMARY KEY,
    guild_id VARCHAR(50) REFERENCES guilds(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(255),
    is_monitored BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Discord users/authors
CREATE TABLE authors (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    discriminator VARCHAR(10),
    is_bot BOOLEAN DEFAULT false,
    is_trader BOOLEAN DEFAULT false, -- Mark known traders
    trader_tier VARCHAR(20), -- 'premium', 'regular', etc.
    avatar_url TEXT,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Discord messages (normalized, no JSONB)
CREATE TABLE messages (
    id VARCHAR(50) PRIMARY KEY,
    channel_id VARCHAR(50) REFERENCES channels(id) ON DELETE CASCADE,
    author_id VARCHAR(50) REFERENCES authors(id) ON DELETE SET NULL,
    content TEXT,
    message_type VARCHAR(50) DEFAULT 'DEFAULT',
    is_edited BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false,
    is_pinned BOOLEAN DEFAULT false,
    has_attachments BOOLEAN DEFAULT false,
    has_embeds BOOLEAN DEFAULT false,
    discord_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    edited_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for common queries
    CONSTRAINT messages_channel_timestamp_idx UNIQUE (channel_id, discord_timestamp, id)
);

-- Message attachments (separate table instead of JSONB)
CREATE TABLE message_attachments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    message_id VARCHAR(50) REFERENCES messages(id) ON DELETE CASCADE,
    filename VARCHAR(255),
    url TEXT,
    content_type VARCHAR(100),
    size_bytes BIGINT,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Message embeds (separate table instead of JSONB)
CREATE TABLE message_embeds (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    message_id VARCHAR(50) REFERENCES messages(id) ON DELETE CASCADE,
    title VARCHAR(500),
    description TEXT,
    url TEXT,
    color INTEGER,
    embed_type VARCHAR(50),
    provider_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Message reactions
CREATE TABLE message_reactions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    message_id VARCHAR(50) REFERENCES messages(id) ON DELETE CASCADE,
    emoji VARCHAR(100) NOT NULL,
    count INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, emoji)
);

-- ============================================
-- TICKER EXTRACTION TABLES
-- ============================================

-- Master list of valid stock tickers
CREATE TABLE tickers (
    symbol VARCHAR(10) PRIMARY KEY,
    exchange VARCHAR(20) NOT NULL,
    company_name VARCHAR(255),
    security_type VARCHAR(50), -- 'Common', 'ETF', 'ADR', etc.
    sector VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    market_cap_tier VARCHAR(20), -- 'large', 'mid', 'small', 'micro'
    avg_volume BIGINT,
    last_validated TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ticker extraction detections
CREATE TABLE ticker_detections (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    message_id VARCHAR(50) REFERENCES messages(id) ON DELETE CASCADE,
    ticker_symbol VARCHAR(10) REFERENCES tickers(symbol) ON DELETE CASCADE,
    detection_method VARCHAR(50) NOT NULL, -- 'cashtag', 'all_caps', 'contextual'
    confidence_score DECIMAL(3,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    context_strength DECIMAL(3,2),
    position_in_message INTEGER, -- Character position where found
    detected_text VARCHAR(50), -- Exact text that was detected
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Prevent duplicate detections
    UNIQUE(message_id, ticker_symbol, position_in_message)
);

-- Ticker blacklist with smart rules
CREATE TABLE ticker_blacklist (
    ticker VARCHAR(10) PRIMARY KEY,
    reason VARCHAR(500) NOT NULL,
    category VARCHAR(50), -- 'common_word', 'trading_term', 'acronym', etc.
    
    -- Disambiguation rules
    min_confidence_required DECIMAL(3,2) DEFAULT 0.90,
    requires_cashtag BOOLEAN DEFAULT false,
    requires_price_context BOOLEAN DEFAULT false,
    
    -- Context patterns (stored as arrays, not JSONB)
    added_by VARCHAR(100) DEFAULT 'system',
    is_permanent BOOLEAN DEFAULT false, -- Can't be overridden
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Blacklist context patterns (normalized)
CREATE TABLE blacklist_patterns (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticker VARCHAR(10) REFERENCES ticker_blacklist(ticker) ON DELETE CASCADE,
    pattern_type VARCHAR(20) NOT NULL, -- 'required', 'excluded'
    pattern TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ticker validation history
CREATE TABLE ticker_validations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticker_symbol VARCHAR(10) NOT NULL,
    validation_source VARCHAR(50), -- 'ai', 'database', 'manual'
    is_valid BOOLEAN NOT NULL,
    confidence DECIMAL(3,2),
    reasoning TEXT,
    context_messages TEXT[], -- Array of message IDs used for validation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ANALYTICS TABLES
-- ============================================

-- Daily ticker statistics (materialized for performance)
CREATE TABLE ticker_daily_stats (
    ticker_symbol VARCHAR(10) REFERENCES tickers(symbol) ON DELETE CASCADE,
    stat_date DATE NOT NULL,
    mention_count INTEGER DEFAULT 0,
    unique_authors INTEGER DEFAULT 0,
    avg_confidence DECIMAL(3,2),
    max_confidence DECIMAL(3,2),
    first_mention_time TIME,
    last_mention_time TIME,
    sentiment_score DECIMAL(3,2), -- -1 to 1
    volume_spike BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticker_symbol, stat_date)
);

-- Author trading performance
CREATE TABLE author_stats (
    author_id VARCHAR(50) REFERENCES authors(id) ON DELETE CASCADE,
    stat_date DATE NOT NULL,
    tickers_mentioned INTEGER DEFAULT 0,
    unique_tickers INTEGER DEFAULT 0,
    avg_confidence DECIMAL(3,2),
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (author_id, stat_date)
);

-- ============================================
-- SYSTEM TABLES
-- ============================================

-- Processing state tracking
CREATE TABLE processing_state (
    id VARCHAR(50) PRIMARY KEY,
    last_processed_message_id VARCHAR(50),
    last_processed_timestamp TIMESTAMP,
    messages_processed BIGINT DEFAULT 0,
    tickers_detected BIGINT DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    processing_time_seconds INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit log for important changes
CREATE TABLE audit_log (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id VARCHAR(100) NOT NULL,
    action VARCHAR(20) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    old_values JSONB,
    new_values JSONB,
    changed_by VARCHAR(100),
    change_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Messages indexes
CREATE INDEX idx_messages_timestamp ON messages(discord_timestamp DESC);
CREATE INDEX idx_messages_author ON messages(author_id);
CREATE INDEX idx_messages_channel ON messages(channel_id);
CREATE INDEX idx_messages_content_trgm ON messages USING gin(content gin_trgm_ops);
CREATE INDEX idx_messages_date ON messages(DATE(discord_timestamp));

-- Ticker detections indexes
CREATE INDEX idx_detections_ticker ON ticker_detections(ticker_symbol);
CREATE INDEX idx_detections_message ON ticker_detections(message_id);
CREATE INDEX idx_detections_confidence ON ticker_detections(confidence_score DESC);
CREATE INDEX idx_detections_created ON ticker_detections(created_at DESC);
CREATE INDEX idx_detections_method ON ticker_detections(detection_method);

-- Stats indexes
CREATE INDEX idx_daily_stats_date ON ticker_daily_stats(stat_date DESC);
CREATE INDEX idx_daily_stats_ticker_date ON ticker_daily_stats(ticker_symbol, stat_date DESC);
CREATE INDEX idx_daily_stats_mentions ON ticker_daily_stats(mention_count DESC);

-- Authors indexes
CREATE INDEX idx_authors_username ON authors(username);
CREATE INDEX idx_authors_trader ON authors(is_trader) WHERE is_trader = true;

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- Current day ticker summary
CREATE OR REPLACE VIEW today_ticker_summary AS
SELECT 
    t.symbol,
    t.exchange,
    t.company_name,
    COUNT(DISTINCT td.message_id) as mention_count,
    COUNT(DISTINCT m.author_id) as unique_authors,
    AVG(td.confidence_score) as avg_confidence,
    MAX(td.confidence_score) as max_confidence,
    MIN(m.discord_timestamp) as first_mention,
    MAX(m.discord_timestamp) as last_mention,
    ARRAY_AGG(DISTINCT td.detection_method) as detection_methods
FROM tickers t
JOIN ticker_detections td ON t.symbol = td.ticker_symbol
JOIN messages m ON td.message_id = m.id
WHERE DATE(m.discord_timestamp) = CURRENT_DATE
GROUP BY t.symbol, t.exchange, t.company_name;

-- Author credibility view
CREATE OR REPLACE VIEW author_credibility AS
SELECT 
    a.id,
    a.username,
    a.is_trader,
    a.trader_tier,
    COUNT(DISTINCT td.ticker_symbol) as unique_tickers_mentioned,
    COUNT(td.id) as total_detections,
    AVG(td.confidence_score) as avg_detection_confidence,
    a.message_count
FROM authors a
LEFT JOIN messages m ON a.id = m.author_id
LEFT JOIN ticker_detections td ON m.id = td.message_id
GROUP BY a.id, a.username, a.is_trader, a.trader_tier, a.message_count;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update daily stats (call periodically)
CREATE OR REPLACE FUNCTION update_daily_ticker_stats(target_date DATE DEFAULT CURRENT_DATE)
RETURNS void AS $$
BEGIN
    INSERT INTO ticker_daily_stats (
        ticker_symbol, stat_date, mention_count, unique_authors,
        avg_confidence, max_confidence, first_mention_time, last_mention_time
    )
    SELECT 
        td.ticker_symbol,
        target_date,
        COUNT(DISTINCT td.message_id),
        COUNT(DISTINCT m.author_id),
        AVG(td.confidence_score),
        MAX(td.confidence_score),
        MIN(m.discord_timestamp::time),
        MAX(m.discord_timestamp::time)
    FROM ticker_detections td
    JOIN messages m ON td.message_id = m.id
    WHERE DATE(m.discord_timestamp) = target_date
    GROUP BY td.ticker_symbol
    ON CONFLICT (ticker_symbol, stat_date) 
    DO UPDATE SET
        mention_count = EXCLUDED.mention_count,
        unique_authors = EXCLUDED.unique_authors,
        avg_confidence = EXCLUDED.avg_confidence,
        max_confidence = EXCLUDED.max_confidence,
        first_mention_time = EXCLUDED.first_mention_time,
        last_mention_time = EXCLUDED.last_mention_time,
        created_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update author message counts
CREATE OR REPLACE FUNCTION update_author_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE authors 
        SET message_count = message_count + 1,
            last_seen = NEW.discord_timestamp
        WHERE id = NEW.author_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_author_stats
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_author_stats();

-- ============================================
-- CONSTRAINTS
-- ============================================

-- Ensure ticker symbols are uppercase
ALTER TABLE tickers ADD CONSTRAINT ticker_uppercase CHECK (symbol = UPPER(symbol));
ALTER TABLE ticker_detections ADD CONSTRAINT detection_ticker_uppercase CHECK (ticker_symbol = UPPER(ticker_symbol));
ALTER TABLE ticker_blacklist ADD CONSTRAINT blacklist_ticker_uppercase CHECK (ticker = UPPER(ticker));
