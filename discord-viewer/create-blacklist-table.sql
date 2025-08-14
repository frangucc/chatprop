-- Create table for ignored/blacklisted tickers
CREATE TABLE IF NOT EXISTS ticker_blacklist (
  ticker VARCHAR(10) PRIMARY KEY,
  reason VARCHAR(255),
  added_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add some common false positives
INSERT INTO ticker_blacklist (ticker, reason, added_by) VALUES
('NOW', 'Common word - not a ticker', 'system'),
('NEW', 'Common word - not a ticker', 'system'),
('OLD', 'Common word - not a ticker', 'system'),
('GET', 'Common word - not a ticker', 'system'),
('SET', 'Common word - not a ticker', 'system'),
('PUT', 'Common word - not a ticker', 'system'),
('RUN', 'Common word - not a ticker', 'system'),
('WAY', 'Common word - not a ticker', 'system'),
('DAY', 'Common word - not a ticker', 'system'),
('END', 'Common word - not a ticker', 'system'),
('TOP', 'Common word - not a ticker', 'system'),
('HOD', 'High of Day - trading term', 'system'),
('LOD', 'Low of Day - trading term', 'system'),
('ATH', 'All Time High - trading term', 'system'),
('ATL', 'All Time Low - trading term', 'system'),
('IPO', 'Initial Public Offering - not a ticker', 'system'),
('CEO', 'Chief Executive Officer - not a ticker', 'system'),
('CFO', 'Chief Financial Officer - not a ticker', 'system'),
('SEC', 'Securities and Exchange Commission - not a ticker', 'system'),
('FDA', 'Food and Drug Administration - not a ticker', 'system')
ON CONFLICT (ticker) DO NOTHING;
