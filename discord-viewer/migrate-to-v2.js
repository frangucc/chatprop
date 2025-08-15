#!/usr/bin/env node

/**
 * Migration Script to V2 Ticker System
 * This script safely migrates your database to the new ticker extraction system
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  console.log('🚀 Starting migration to V2 ticker system...\n');
  
  try {
    // Step 1: Run the SQL migration
    console.log('📊 Creating new database structures...');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'migrations', 'create-ticker-mentions.sql'),
      'utf8'
    );
    
    // Split and execute statements one by one
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const statement of statements) {
      try {
        await pool.query(statement + ';');
        console.log('✅ Executed: ' + statement.substring(0, 50) + '...');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('⏭️  Skipped (already exists): ' + statement.substring(0, 50) + '...');
        } else {
          console.error('❌ Error executing statement:', error.message);
        }
      }
    }
    
    console.log('\n📋 Updating blacklist with context rules...');
    
    // Step 2: Add context rules for common blacklisted words
    const contextRules = [
      {
        ticker: 'ADD',
        rules: {
          requiresPhrases: ['shares', 'position', 'bought', 'sold', '$'],
          excludesPhrases: ['add more', 'add to', "I'll add", 'will add'],
          minConfidence: 0.85
        },
        note: 'Common word "add" - only valid when used as stock ticker with strong trading context'
      },
      {
        ticker: 'HAS',
        rules: {
          requiresPhrases: ['$', 'shares', 'position', 'price'],
          excludesPhrases: ['has been', 'it has', 'he has', 'she has'],
          minConfidence: 0.90
        },
        note: 'Common word "has" - requires cashtag or very strong trading context'
      },
      {
        ticker: 'CAN',
        rules: {
          requiresPhrases: ['$', 'shares', 'Canadian', 'cannabis'],
          excludesPhrases: ['I can', 'you can', 'we can', 'they can'],
          minConfidence: 0.85
        },
        note: 'Common word "can" - usually Canadian company, needs strong context'
      },
      {
        ticker: 'ALL',
        rules: {
          requiresPhrases: ['$', 'Allstate', 'insurance'],
          excludesPhrases: ['all in', 'all of', 'all the', 'all my'],
          minConfidence: 0.90
        },
        note: 'Common word "all" - Allstate ticker, needs very strong context'
      },
      {
        ticker: 'GO',
        rules: {
          requiresPhrases: ['$', 'Grocery', 'Outlet'],
          excludesPhrases: ['go to', 'go up', 'go down', 'lets go', "let's go"],
          minConfidence: 0.95
        },
        note: 'Common word "go" - Grocery Outlet, almost always needs cashtag'
      }
    ];
    
    for (const rule of contextRules) {
      const existing = await pool.query(
        'SELECT ticker FROM ticker_blacklist WHERE ticker = $1',
        [rule.ticker]
      );
      
      if (existing.rows.length > 0) {
        // Update existing blacklist entry
        await pool.query(`
          UPDATE ticker_blacklist 
          SET 
            disambiguation_rules = $1,
            context_note = $2,
            min_confidence_override = $3
          WHERE ticker = $4
        `, [
          JSON.stringify(rule.rules),
          rule.note,
          rule.rules.minConfidence,
          rule.ticker
        ]);
        console.log(`✅ Updated context rules for ${rule.ticker}`);
      } else {
        // Insert new blacklist entry
        await pool.query(`
          INSERT INTO ticker_blacklist (
            ticker, reason, context_note, disambiguation_rules, 
            min_confidence_override, added_by
          ) VALUES ($1, $2, $3, $4, $5, 'migration')
        `, [
          rule.ticker,
          'Common English word that is also a ticker',
          rule.note,
          JSON.stringify(rule.rules),
          rule.rules.minConfidence
        ]);
        console.log(`✅ Added context rules for ${rule.ticker}`);
      }
    }
    
    console.log('\n🔄 Migrating existing mention data...');
    
    // Step 3: Populate ticker_mentions from existing data (if not already done)
    const mentionsExist = await pool.query(
      'SELECT COUNT(*) as count FROM ticker_mentions'
    );
    
    if (mentionsExist.rows[0].count == 0) {
      console.log('📝 Populating ticker_mentions from existing stocks data...');
      
      // Get all stocks with mentions
      const stocks = await pool.query(`
        SELECT ticker, first_mention_message_id, first_mention_timestamp, 
               first_mention_author, detection_confidence
        FROM stocks 
        WHERE first_mention_message_id IS NOT NULL
      `);
      
      for (const stock of stocks.rows) {
        try {
          await pool.query(`
            INSERT INTO ticker_mentions (
              ticker, message_id, confidence, detected_at, author_name
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (ticker, message_id) DO NOTHING
          `, [
            stock.ticker,
            stock.first_mention_message_id,
            stock.detection_confidence,
            stock.first_mention_timestamp,
            stock.first_mention_author
          ]);
        } catch (error) {
          // Ignore conflicts
        }
      }
      
      console.log(`✅ Migrated ${stocks.rows.length} initial mentions`);
    } else {
      console.log('⏭️  ticker_mentions table already has data, skipping migration');
    }
    
    console.log('\n📊 Recalculating mention counts...');
    await pool.query('SELECT update_ticker_mention_counts()');
    
    console.log('\n✨ Migration completed successfully!');
    
    // Show summary
    const summary = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ticker_mentions) as total_mentions,
        (SELECT COUNT(DISTINCT ticker) FROM ticker_mentions) as unique_tickers,
        (SELECT COUNT(*) FROM ticker_blacklist) as blacklisted,
        (SELECT COUNT(*) FROM ticker_blacklist WHERE disambiguation_rules IS NOT NULL) as with_rules
    `);
    
    const s = summary.rows[0];
    console.log('\n📈 Database Summary:');
    console.log('━'.repeat(50));
    console.log(`Total tracked mentions: ${s.total_mentions}`);
    console.log(`Unique tickers: ${s.unique_tickers}`);
    console.log(`Blacklisted tickers: ${s.blacklisted}`);
    console.log(`Blacklist with context rules: ${s.with_rules}`);
    console.log('━'.repeat(50));
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
runMigration();
