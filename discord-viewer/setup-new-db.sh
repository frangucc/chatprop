#!/bin/bash

# Setup script for new database architecture
echo "🚀 Setting up new ChatProp database architecture..."

# Export the new database URL
export DATABASE_URL="postgresql://neondb_owner:npg_Z7txvpsw2TIG@ep-dawn-bird-aeah6d7i-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Create the schema
echo "📊 Creating database schema..."
psql "$DATABASE_URL" < database-v2/01-schema.sql

if [ $? -eq 0 ]; then
    echo "✅ Schema created successfully!"
else
    echo "❌ Failed to create schema"
    exit 1
fi

# Load essential data (blacklist, known tickers)
echo "📝 Loading essential data..."
cat > /tmp/load-essential.sql << 'EOF'
-- Load common ticker blacklist entries
INSERT INTO ticker_blacklist (ticker, reason, category, min_confidence_required, requires_cashtag) VALUES
('ADD', 'Common word - requires strong context', 'common_word', 0.85, false),
('ALL', 'Common word - Allstate ticker', 'common_word', 0.90, false),
('CAN', 'Common word - Canadian stocks', 'common_word', 0.85, false),
('GO', 'Common word - Grocery Outlet', 'common_word', 0.95, true),
('HAS', 'Common word - requires cashtag', 'common_word', 0.90, true),
('NEW', 'Common word', 'common_word', 0.95, true),
('BEST', 'Common word', 'common_word', 0.95, true),
('BIG', 'Common word', 'common_word', 0.95, true),
('GOOD', 'Common word', 'common_word', 0.95, true),
('PUMP', 'Trading term, not a ticker', 'trading_term', 1.00, false),
('DUMP', 'Trading term, not a ticker', 'trading_term', 1.00, false),
('MOON', 'Trading slang', 'trading_term', 1.00, false),
('HODL', 'Trading slang', 'trading_term', 1.00, false)
ON CONFLICT (ticker) DO NOTHING;

-- Add context patterns for disambiguation
INSERT INTO blacklist_patterns (ticker, pattern_type, pattern) VALUES
('ADD', 'excluded', 'I''ll add'),
('ADD', 'excluded', 'will add'),
('ADD', 'excluded', 'add more'),
('ADD', 'required', 'shares'),
('ADD', 'required', '$ADD'),
('HAS', 'excluded', 'it has'),
('HAS', 'excluded', 'has been'),
('HAS', 'required', '$HAS'),
('GO', 'excluded', 'let''s go'),
('GO', 'excluded', 'go up'),
('GO', 'excluded', 'go down'),
('GO', 'required', '$GO')
ON CONFLICT DO NOTHING;

-- Load major exchange tickers (sample - you'd expand this)
INSERT INTO tickers (symbol, exchange, company_name, security_type) VALUES
('AAPL', 'NASDAQ', 'Apple Inc.', 'Common'),
('MSFT', 'NASDAQ', 'Microsoft Corporation', 'Common'),
('GOOGL', 'NASDAQ', 'Alphabet Inc.', 'Common'),
('AMZN', 'NASDAQ', 'Amazon.com Inc.', 'Common'),
('TSLA', 'NASDAQ', 'Tesla Inc.', 'Common'),
('META', 'NASDAQ', 'Meta Platforms Inc.', 'Common'),
('NVDA', 'NASDAQ', 'NVIDIA Corporation', 'Common'),
('SPY', 'NYSE', 'SPDR S&P 500 ETF', 'ETF'),
('QQQ', 'NASDAQ', 'Invesco QQQ Trust', 'ETF')
ON CONFLICT (symbol) DO NOTHING;
EOF

psql "$DATABASE_URL" < /tmp/load-essential.sql

echo "✨ Database setup complete!"
echo ""
echo "Next steps:"
echo "1. Update your .env.local with DATABASE_URL"
echo "2. Run: node test-new-db.js (to verify connection)"
echo "3. Start processing messages with the new system"
