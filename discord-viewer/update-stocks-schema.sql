-- Add missing columns to existing stocks table for new extractor
ALTER TABLE stocks 
ADD COLUMN IF NOT EXISTS mention_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS detection_confidence DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS first_mention_timestamp TIMESTAMP,
ADD COLUMN IF NOT EXISTS first_mention_author VARCHAR(255),
ADD COLUMN IF NOT EXISTS first_mention_message_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS first_mention_text TEXT,
ADD COLUMN IF NOT EXISTS detection_method VARCHAR(100);

-- Update existing rows to have default values
UPDATE stocks 
SET mention_count = 1 
WHERE mention_count IS NULL;

UPDATE stocks 
SET detection_confidence = 0.80 
WHERE detection_confidence IS NULL;

UPDATE stocks 
SET is_genuine_stock = COALESCE(is_valid, true) 
WHERE is_genuine_stock IS NULL;
