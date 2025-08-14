-- Create database trigger for WebSocket notifications
CREATE OR REPLACE FUNCTION notify_ticker_update()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('ticker_updates', json_build_object(
    'ticker', NEW.ticker,
    'exchange', NEW.exchange,
    'mention_count', NEW.mention_count,
    'detection_confidence', NEW.detection_confidence,
    'ai_confidence', NEW.ai_confidence,
    'first_mention_timestamp', NEW.first_mention_timestamp,
    'first_mention_author', NEW.first_mention_author,
    'is_genuine_stock', NEW.is_genuine_stock
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on stocks table
DROP TRIGGER IF EXISTS ticker_update_trigger ON stocks;
CREATE TRIGGER ticker_update_trigger
  AFTER INSERT OR UPDATE ON stocks
  FOR EACH ROW
  EXECUTE FUNCTION notify_ticker_update();

-- Create listed_securities table if it doesn't exist
CREATE TABLE IF NOT EXISTS listed_securities (
  ticker VARCHAR(10) PRIMARY KEY,
  exchange VARCHAR(20) NOT NULL,
  security_type VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert some sample data for testing
INSERT INTO listed_securities (ticker, exchange, security_type, is_active) VALUES
('AAPL', 'NASDAQ', 'Common', true),
('MSFT', 'NASDAQ', 'Common', true),
('GOOGL', 'NASDAQ', 'Common', true),
('AMZN', 'NASDAQ', 'Common', true),
('TSLA', 'NASDAQ', 'Common', true),
('NVDA', 'NASDAQ', 'Common', true),
('META', 'NASDAQ', 'Common', true),
('NFLX', 'NASDAQ', 'Common', true),
('XPON', 'NASDAQ', 'Common', true),
('MNTS', 'NASDAQ', 'Common', true),
('RGTI', 'NASDAQ', 'Common', true),
('TRAW', 'NASDAQ', 'Common', true),
('SPY', 'NYSE', 'ETF', true),
('QQQ', 'NASDAQ', 'ETF', true),
('IWM', 'NYSE', 'ETF', true),
('F', 'NYSE', 'Common', true),
('T', 'NYSE', 'Common', true),
('C', 'NYSE', 'Common', true)
ON CONFLICT (ticker) DO NOTHING;
