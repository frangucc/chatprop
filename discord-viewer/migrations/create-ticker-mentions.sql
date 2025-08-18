-- Create ticker_mentions table to track unique message-ticker pairs
-- This prevents duplicate counting and provides accurate mention tracking
CREATE TABLE IF NOT EXISTS ticker_mentions (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  message_id VARCHAR(50) NOT NULL,
  confidence DECIMAL(3,2),
  detected_at TIMESTAMP NOT NULL,
  author_name VARCHAR(255),
  context_strength DECIMAL(3,2),
  detection_method VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Ensure each ticker-message pair is unique
  UNIQUE(ticker, message_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ticker_mentions_ticker ON ticker_mentions(ticker);
CREATE INDEX IF NOT EXISTS idx_ticker_mentions_message ON ticker_mentions(message_id);
CREATE INDEX IF NOT EXISTS idx_ticker_mentions_date ON ticker_mentions(detected_at);
CREATE INDEX IF NOT EXISTS idx_ticker_mentions_author ON ticker_mentions(author_name);

-- Add context_note and disambiguation_rules to blacklist table
ALTER TABLE ticker_blacklist 
ADD COLUMN IF NOT EXISTS disambiguation_rules JSONB,
ADD COLUMN IF NOT EXISTS min_confidence_override DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS requires_context TEXT[];

-- Update stocks table to use proper mention counting
ALTER TABLE stocks 
ADD COLUMN IF NOT EXISTS last_validated TIMESTAMP,
ADD COLUMN IF NOT EXISTS validation_source VARCHAR(50),
ADD COLUMN IF NOT EXISTS unique_authors INTEGER DEFAULT 0;

-- Create a view for easy ticker stats
CREATE OR REPLACE VIEW ticker_stats AS
SELECT 
  s.ticker,
  s.exchange,
  COUNT(DISTINCT tm.message_id) as actual_mention_count,
  COUNT(DISTINCT tm.author_name) as unique_authors,
  AVG(tm.confidence) as avg_confidence,
  MAX(tm.confidence) as max_confidence,
  MIN(tm.detected_at) as first_seen,
  MAX(tm.detected_at) as last_seen,
  s.is_genuine_stock,
  EXISTS(SELECT 1 FROM ticker_blacklist WHERE ticker = s.ticker) as is_blacklisted
FROM stocks s
LEFT JOIN ticker_mentions tm ON s.ticker = tm.ticker
WHERE tm.detected_at >= CURRENT_DATE
GROUP BY s.ticker, s.exchange, s.is_genuine_stock;

-- Function to recalculate mention counts
CREATE OR REPLACE FUNCTION update_ticker_mention_counts()
RETURNS void AS $$
BEGIN
  UPDATE stocks s
  SET 
    mention_count = COALESCE(stats.mention_count, 0),
    unique_authors = COALESCE(stats.unique_authors, 0),
    updated_at = CURRENT_TIMESTAMP
  FROM (
    SELECT 
      ticker,
      COUNT(DISTINCT message_id) as mention_count,
      COUNT(DISTINCT author_name) as unique_authors
    FROM ticker_mentions
    WHERE detected_at >= CURRENT_DATE
    GROUP BY ticker
  ) stats
  WHERE s.ticker = stats.ticker;
END;
$$ LANGUAGE plpgsql;
