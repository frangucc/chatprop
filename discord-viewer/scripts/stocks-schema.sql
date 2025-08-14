-- Create stocks table to cache validated stock information
CREATE TABLE IF NOT EXISTS stocks (
  ticker VARCHAR(10) PRIMARY KEY,
  name VARCHAR(255),
  sector VARCHAR(100),
  industry VARCHAR(100),
  market_cap BIGINT,
  currency VARCHAR(10),
  exchange VARCHAR(100),
  country VARCHAR(10),
  logo_url TEXT,
  website TEXT,
  ipo_date DATE,
  is_valid BOOLEAN DEFAULT true,
  ai_confidence DECIMAL(3,2), -- 0.00 to 1.00 confidence score
  last_validated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create stock mentions analysis table
CREATE TABLE IF NOT EXISTS stock_mentions (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) REFERENCES stocks(ticker),
  mention_count INTEGER,
  first_mention_time TIMESTAMP,
  last_mention_time TIMESTAMP,
  sample_messages JSONB,
  ai_context_analysis TEXT,
  is_genuine_discussion BOOLEAN DEFAULT true,
  analysis_date DATE DEFAULT CURRENT_DATE,
  UNIQUE(ticker, analysis_date)
);

-- Indexes for performance
CREATE INDEX idx_stocks_valid ON stocks(is_valid);
CREATE INDEX idx_stocks_confidence ON stocks(ai_confidence);
CREATE INDEX idx_mentions_ticker_date ON stock_mentions(ticker, analysis_date);
CREATE INDEX idx_mentions_genuine ON stock_mentions(is_genuine_discussion);
