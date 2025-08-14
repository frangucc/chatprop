#!/usr/bin/env node

// Process real Discord messages with ticker mentions
const TickerExtractor = require('./lib/ticker-extractor');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function processRealTickers() {
  const extractor = new TickerExtractor(
    process.env.DATABASE_URL,
    process.env.ANTHROPIC_API_KEY
  );

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔍 Processing real Discord messages with ticker mentions...');
    
    // Get recent messages with clear ticker patterns
    const messages = await pool.query(`
      SELECT id, content, author_id, author_name, timestamp 
      FROM discord_messages 
      WHERE timestamp >= CURRENT_DATE 
      AND (
        content ~* '\\$[A-Z]{3,5}\\b' OR  -- Cashtags like $SNOA
        content ~* '\\b[A-Z]{3,5}\\b'     -- All caps words
      )
      AND content NOT LIKE '%http%'       -- Skip URLs
      ORDER BY timestamp DESC 
      LIMIT 20
    `);
    
    console.log(`📝 Found ${messages.rows.length} messages with potential tickers`);
    
    let totalDetections = 0;
    
    for (const msg of messages.rows) {
      console.log(`\n📝 Processing: "${msg.content}" by ${msg.author_name}`);
      
      try {
        const results = await extractor.processSingleMessage(
          msg.id,
          msg.content,
          msg.author_name, // Use author_name instead of author_id
          msg.timestamp
        );
        
        if (results.length > 0) {
          console.log(`✅ Found ${results.length} ticker detections:`);
          results.forEach(detection => {
            console.log(`  - ${detection.ticker}: confidence ${detection.detection_confidence.toFixed(2)} (${detection.detection_method})`);
          });
          totalDetections += results.length;
        } else {
          console.log(`❌ No tickers detected`);
        }
      } catch (error) {
        console.error(`❌ Error processing message: ${error.message}`);
      }
    }
    
    console.log(`\n🎯 Total detections: ${totalDetections}`);
    
    // Show current stocks in database
    console.log('\n📊 Current stocks in database:');
    const stocks = await pool.query(`
      SELECT ticker, mention_count, detection_confidence, is_genuine_stock, 
             first_mention_author, first_mention_timestamp
      FROM stocks 
      WHERE first_mention_timestamp >= CURRENT_DATE
      ORDER BY first_mention_timestamp DESC
    `);
    
    console.log(`Found ${stocks.rows.length} stocks from today:`);
    stocks.rows.forEach(stock => {
      console.log(`  - ${stock.ticker}: ${stock.mention_count} mentions, confidence ${stock.detection_confidence}, by ${stock.first_mention_author}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
    await extractor.close();
  }
}

processRealTickers();
