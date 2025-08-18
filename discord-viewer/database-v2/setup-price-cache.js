const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

async function setupPriceCache() {
  const client = new Client({
    connectionString: process.env.DATABASE2_URL
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Create price cache table
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_price_cache (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        price DECIMAL(10, 4),
        price_min DECIMAL(10, 4),
        price_max DECIMAL(10, 4),
        trade_count INTEGER DEFAULT 0,
        is_market_hours BOOLEAN DEFAULT true,
        window_seconds INTEGER DEFAULT 10,
        api_success BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, timestamp)
      );
    `);
    console.log('Created stock_price_cache table');

    // Create index for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_price_cache_lookup 
      ON stock_price_cache(symbol, timestamp);
    `);
    console.log('Created index');

    // Create table to track failed lookups (for blacklist candidates)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticker_lookup_failures (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        failure_count INTEGER DEFAULT 1,
        last_failure TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        first_failure TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol)
      );
    `);
    console.log('Created ticker_lookup_failures table');

    console.log('Price cache setup complete!');
    
  } catch (error) {
    console.error('Error setting up price cache:', error);
  } finally {
    await client.end();
  }
}

setupPriceCache();
