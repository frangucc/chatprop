#!/usr/bin/env node

// Test single message extraction
const TickerExtractor = require('./lib/ticker-extractor');
require('dotenv').config({ path: '.env.local' });

async function testSingleMessage() {
  const extractor = new TickerExtractor(
    process.env.DATABASE_URL,
    process.env.ANTHROPIC_API_KEY
  );

  try {
    console.log('🧪 Testing single message extraction...');
    
    // Test with a sample message containing tickers
    const testMessage = "RGTI looking good today, might grab some XPON calls too. TSLA to the moon!";
    const messageId = 'test_' + Date.now();
    const authorId = 'test_author';
    const timestamp = new Date().toISOString();
    
    console.log(`📝 Test message: "${testMessage}"`);
    console.log('🔍 Processing...');
    
    const results = await extractor.processSingleMessage(
      messageId,
      testMessage,
      authorId,
      timestamp
    );
    
    console.log(`✅ Found ${results.length} ticker detections:`);
    results.forEach(detection => {
      console.log(`  - ${detection.ticker}: confidence ${detection.detection_confidence.toFixed(2)} (${detection.detection_method})`);
    });
    
    // Test with a real message from the database
    console.log('\n🔍 Testing with a real message from database...');
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    const realMessage = await pool.query(`
      SELECT id, content, author_id, timestamp 
      FROM discord_messages 
      WHERE content ~* '\\b[A-Z]{3,5}\\b' 
      AND timestamp >= CURRENT_DATE 
      ORDER BY timestamp DESC 
      LIMIT 1
    `);
    
    if (realMessage.rows.length > 0) {
      const msg = realMessage.rows[0];
      console.log(`📝 Real message: "${msg.content}"`);
      
      const realResults = await extractor.processSingleMessage(
        msg.id,
        msg.content,
        msg.author_id,
        msg.timestamp
      );
      
      console.log(`✅ Found ${realResults.length} ticker detections from real message:`);
      realResults.forEach(detection => {
        console.log(`  - ${detection.ticker}: confidence ${detection.detection_confidence.toFixed(2)} (${detection.detection_method})`);
      });
    } else {
      console.log('❌ No messages with potential tickers found in database');
    }
    
    await pool.end();
    await extractor.close();
    
  } catch (error) {
    console.error('❌ Error testing extractor:', error);
    await extractor.close();
  }
}

testSingleMessage();
