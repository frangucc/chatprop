#!/usr/bin/env node

// Test with actual Discord messages
const TickerExtractor = require('./lib/ticker-extractor');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function testRealMessages() {
  const extractor = new TickerExtractor(
    process.env.DATABASE_URL,
    process.env.ANTHROPIC_API_KEY
  );

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔍 Testing with real Discord messages...');
    
    // Get recent messages from today
    const messages = await pool.query(`
      SELECT id, content, author_id, timestamp 
      FROM discord_messages 
      WHERE timestamp >= CURRENT_DATE 
      ORDER BY timestamp DESC 
      LIMIT 5
    `);
    
    console.log(`📝 Found ${messages.rows.length} recent messages`);
    
    for (const msg of messages.rows) {
      console.log(`\n📝 Processing: "${msg.content}"`);
      
      try {
        const results = await extractor.processSingleMessage(
          msg.id,
          msg.content,
          msg.author_id,
          msg.timestamp
        );
        
        if (results.length > 0) {
          console.log(`✅ Found ${results.length} ticker detections:`);
          results.forEach(detection => {
            console.log(`  - ${detection.ticker}: confidence ${detection.detection_confidence.toFixed(2)} (${detection.detection_method})`);
          });
        } else {
          console.log(`❌ No tickers detected`);
        }
      } catch (error) {
        console.error(`❌ Error processing message: ${error.message}`);
      }
    }
    
    // Check what's currently in the stocks table
    console.log('\n📊 Current stocks in database:');
    const stocks = await pool.query(`
      SELECT ticker, mention_count, detection_confidence, is_genuine_stock, first_mention_timestamp
      FROM stocks 
      WHERE first_mention_timestamp >= CURRENT_DATE
      ORDER BY first_mention_timestamp DESC
      LIMIT 10
    `);
    
    console.log(`Found ${stocks.rows.length} stocks from today:`);
    stocks.rows.forEach(stock => {
      console.log(`  - ${stock.ticker}: ${stock.mention_count} mentions, confidence ${stock.detection_confidence}, genuine: ${stock.is_genuine_stock}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
    await extractor.close();
  }
}

testRealMessages();
