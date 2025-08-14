-- Create stocks table for ticker extraction results
CREATE TABLE IF NOT EXISTS stocks (
  ticker VARCHAR(10) PRIMARY KEY,
  exchange VARCHAR(20),
  mention_count INTEGER DEFAULT 1,
  detection_confidence DECIMAL(3,2),
  ai_confidence DECIMAL(3,2),
  first_mention_timestamp TIMESTAMP,
  first_mention_author VARCHAR(255),
  first_mention_message_id VARCHAR(50),
  first_mention_text TEXT,
  detection_method VARCHAR(100),
  is_genuine_stock BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
