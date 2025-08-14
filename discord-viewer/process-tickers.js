#!/usr/bin/env node

// Simple real-time ticker processor for today's messages
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Quick exclusion list
const excludeWords = new Set(['SELL', 'BUY', 'HIGH', 'LOW', 'HOLD', 'MORE', 'JUST', 
  'THE', 'AND', 'FOR', 'WITH', 'FROM', 'THAT', 'THIS', 'HAVE', 'WILL', 'YOUR', 
  'WHAT', 'WHEN', 'WHERE', 'LOL', 'ALL', 'ANY', 'ARE', 'ASK', 'NYSE', 'NASDAQ', 
  'CEO', 'CFO', 'IPO', 'ETF', 'FDA', 'SEC', 'USA', 'USD', 'EST', 'CST', 'PST']);

async function processToday() {
  console.log('🚀 Processing today\'s Discord messages for stock tickers...');
  
  // Get today's messages
  const result = await pool.query(`
    SELECT content 
    FROM discord_messages 
    WHERE timestamp >= CURRENT_DATE
    ORDER BY timestamp DESC
  `);
  
  console.log(`Found ${result.rows.length} messages from today`);
  
  // Extract all potential tickers
  const tickerMap = new Map();
  
  for (const row of result.rows) {
    const matches = (row.content || '').match(/\b[A-Z]{3,5}\b/g) || [];
    for (const ticker of matches) {
      if (!excludeWords.has(ticker)) {
        if (!tickerMap.has(ticker)) {
          tickerMap.set(ticker, []);
        }
        tickerMap.get(ticker).push(row.content);
      }
    }
  }
  
  console.log(`Found ${tickerMap.size} potential tickers to validate`);
  
  // Validate each ticker with AI
  for (const [ticker, messages] of tickerMap.entries()) {
    try {
      // Check if already validated
      const existing = await pool.query(
        'SELECT ticker, is_genuine_stock FROM stocks WHERE ticker = $1',
        [ticker]
      );
      
      if (existing.rows.length > 0) {
        console.log(`✓ ${ticker} already validated: ${existing.rows[0].is_genuine_stock ? 'STOCK' : 'NOT STOCK'}`);
        continue;
      }
      
      console.log(`🔍 Validating ${ticker}...`);
      
      // Call validation API
      const response = await fetch('http://localhost:3000/api/validate-ticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          messages: messages.slice(0, 3).map(content => ({ content }))
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.isStock && result.confidence >= 70) {
          console.log(`✅ ${ticker} is a REAL STOCK (${result.confidence}% confidence)`);
        } else {
          console.log(`❌ ${ticker} is NOT a stock (${result.reason})`);
        }
      }
    } catch (error) {
      console.error(`Error validating ${ticker}:`, error.message);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('✅ Done processing today\'s tickers!');
  process.exit(0);
}

processToday().catch(console.error);
