const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkOMNDDuplicates() {
  try {
    console.log('🔍 Checking OMND duplicates...\n');
    
    // Check for OMND entries in stocks table
    const stocksResult = await pool.query('SELECT * FROM stocks WHERE ticker = $1', ['OMND']);
    console.log('OMND entries in stocks table:');
    console.log(JSON.stringify(stocksResult.rows, null, 2));
    
    // Check for any case variations
    const caseResult = await pool.query('SELECT ticker, mention_count FROM stocks WHERE UPPER(ticker) = $1', ['OMND']);
    console.log('\nCase variations of OMND:');
    console.log(JSON.stringify(caseResult.rows, null, 2));
    
    // Check if there are multiple entries with similar tickers
    const similarResult = await pool.query(`
      SELECT ticker, mention_count, detection_confidence, first_mention_author 
      FROM stocks 
      WHERE ticker ILIKE '%OMND%' 
      ORDER BY ticker
    `);
    console.log('\nSimilar ticker entries:');
    console.log(JSON.stringify(similarResult.rows, null, 2));
    
    // Check recent messages mentioning OMND
    const messagesResult = await pool.query(`
      SELECT id, content, author_name, timestamp 
      FROM discord_messages 
      WHERE content ILIKE '%OMND%' 
      ORDER BY timestamp DESC 
      LIMIT 5
    `);
    console.log('\nRecent messages mentioning OMND:');
    console.log(JSON.stringify(messagesResult.rows, null, 2));
    
    // Check the API query that's being used
    console.log('\n🔍 Testing API query...');
    const apiResult = await pool.query(`
      SELECT 
        s.ticker,
        s.exchange,
        s.mention_count,
        s.detection_confidence,
        s.ai_confidence,
        s.first_mention_timestamp,
        s.first_mention_author,
        s.is_genuine_stock
      FROM stocks s
      WHERE s.is_genuine_stock = true 
      AND s.detection_confidence >= 0.70
      AND s.ticker NOT IN (SELECT ticker FROM ticker_blacklist)
      AND s.ticker ILIKE '%OMND%'
      ORDER BY mention_count DESC, first_mention_timestamp DESC
    `);
    console.log('API query results for OMND:');
    console.log(JSON.stringify(apiResult.rows, null, 2));
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
}

checkOMNDDuplicates();
