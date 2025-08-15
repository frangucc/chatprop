#!/usr/bin/env node

/**
 * Test script for new database architecture
 * Verifies connection and basic operations
 */

const DatabaseClient = require('./database-v2/db-client');

// Use the new database URL
const DATABASE_URL = process.env.DATABASE2_URL || 
  'postgresql://neondb_owner:npg_Z7txvpsw2TIG@ep-dawn-bird-aeah6d7i-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

async function testDatabase() {
  console.log('🧪 Testing new database architecture...\n');
  
  const db = new DatabaseClient(DATABASE_URL);
  
  try {
    // Test 1: Basic connectivity
    console.log('1️⃣ Testing connection...');
    const result = await db.pool.query('SELECT NOW()');
    console.log('✅ Connected successfully at:', result.rows[0].now);
    
    // Test 2: Insert test author
    console.log('\n2️⃣ Testing author insertion...');
    const author = await db.upsertAuthor({
      id: 'test_user_123',
      username: 'TestTrader',
      isBot: false
    });
    console.log('✅ Author created:', author.username);
    
    // Test 3: Insert test ticker
    console.log('\n3️⃣ Testing ticker insertion...');
    const ticker = await db.upsertTicker({
      symbol: 'TEST',
      exchange: 'NASDAQ',
      companyName: 'Test Corporation'
    });
    console.log('✅ Ticker created:', ticker.symbol);
    
    // Test 4: Check blacklist
    console.log('\n4️⃣ Testing blacklist...');
    const blacklisted = await db.checkBlacklist('ADD');
    if (blacklisted) {
      console.log('✅ Blacklist working - found:', blacklisted.ticker);
    } else {
      console.log('⚠️  Blacklist empty - run setup script first');
    }
    
    // Test 5: Test transaction
    console.log('\n5️⃣ Testing transactions...');
    await db.transaction(async (client) => {
      await client.query('SELECT 1');
      console.log('✅ Transaction support working');
    });
    
    // Show table status
    console.log('\n📊 Database Status:');
    console.log('━'.repeat(50));
    
    const tables = [
      'authors', 'messages', 'tickers', 
      'ticker_detections', 'ticker_blacklist'
    ];
    
    for (const table of tables) {
      const countResult = await db.pool.query(
        `SELECT COUNT(*) as count FROM ${table}`
      );
      console.log(`${table}: ${countResult.rows[0].count} records`);
    }
    
    console.log('━'.repeat(50));
    console.log('\n✨ All tests passed! Database is ready.');
    
    // Clean up test data
    await db.pool.query("DELETE FROM authors WHERE id = 'test_user_123'");
    await db.pool.query("DELETE FROM tickers WHERE symbol = 'TEST'");
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run tests
testDatabase();
