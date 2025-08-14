#!/usr/bin/env node

// Automated ticker processor - runs continuously
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const excludeWords = new Set(['SELL', 'BUY', 'HIGH', 'LOW', 'HOLD', 'MORE', 'JUST', 
  'THE', 'AND', 'FOR', 'WITH', 'FROM', 'THAT', 'THIS', 'HAVE', 'WILL', 'YOUR', 
  'WHAT', 'WHEN', 'WHERE', 'LOL', 'ALL', 'ANY', 'ARE', 'ASK', 'NYSE', 'NASDAQ', 
  'CEO', 'CFO', 'IPO', 'ETF', 'FDA', 'SEC', 'USA', 'USD', 'EST', 'CST', 'PST',
  'HOD', 'LOD', 'ATH', 'ATL']);

let lastProcessedId = null;

async function processNewMessages() {
  try {
    // Get new messages since last check (CST timezone)
    let query = `
      SELECT id, content 
      FROM discord_messages 
      WHERE timestamp >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date
    `;
    
    if (lastProcessedId) {
      query += ` AND id > '${lastProcessedId}'`;
    }
    
    query += ` ORDER BY timestamp ASC LIMIT 50`;
    
    const result = await pool.query(query);
    
    if (result.rows.length > 0) {
      console.log(`[${new Date().toLocaleTimeString()}] Processing ${result.rows.length} new messages...`);
      
      for (const row of result.rows) {
        const matches = (row.content || '').match(/\b[A-Z]{3,5}\b/g) || [];
        
        for (const ticker of matches) {
          if (!excludeWords.has(ticker)) {
            // Check if already validated
            const existing = await pool.query(
              'SELECT ticker FROM stocks WHERE ticker = $1',
              [ticker]
            );
            
            if (existing.rows.length === 0) {
              console.log(`  🔍 Validating new ticker: ${ticker}`);
              
              // Get context messages
              const context = await pool.query(
                `SELECT content FROM discord_messages 
                 WHERE content ~* $1 
                 ORDER BY timestamp DESC 
                 LIMIT 3`,
                [`\\b${ticker}\\b`]
              );
              
              // Validate with AI
              try {
                const response = await fetch('http://localhost:3000/api/validate-ticker', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ticker,
                    messages: context.rows.map(r => ({ content: r.content }))
                  })
                });
                
                if (response.ok) {
                  const result = await response.json();
                  if (result.isStock && result.confidence >= 70) {
                    console.log(`  ✅ ${ticker} validated as REAL STOCK`);
                  } else {
                    console.log(`  ❌ ${ticker} rejected (not a stock)`);
                  }
                }
              } catch (err) {
                console.error(`  ⚠️ Error validating ${ticker}:`, err.message);
              }
              
              // Small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
        
        lastProcessedId = row.id;
      }
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] No new messages`);
    }
  } catch (error) {
    console.error('Error processing messages:', error.message);
  }
}

async function run() {
  console.log('🚀 Auto-processor started! Checking for new messages every 30 seconds...');
  console.log('Press Ctrl+C to stop\n');
  
  // Process immediately
  await processNewMessages();
  
  // Then check every 30 seconds
  setInterval(processNewMessages, 30000);
}

run().catch(console.error);
