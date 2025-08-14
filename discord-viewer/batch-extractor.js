#!/usr/bin/env node

// Batch ticker extractor - processes historical messages for catch-up
const TickerExtractor = require('./lib/ticker-extractor');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

class BatchExtractor {
  constructor() {
    this.extractor = new TickerExtractor(
      process.env.DATABASE_URL,
      process.env.ANTHROPIC_API_KEY
    );
    
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }

  async processTodaysMessages() {
    console.log('🔄 Starting batch processing of today\'s messages...');
    
    try {
      // Get all messages from today
      const messages = await this.extractor.getTodaysMessages();
      console.log(`Found ${messages.length} messages from today`);
      
      if (messages.length === 0) {
        console.log('No messages to process');
        return;
      }
      
      // Clear existing ticker data for today (optional - comment out to keep accumulating)
      // await this.clearTodaysTickers();
      
      // Process in batches of 5 to respect API limits
      const batchSize = 5;
      let processed = 0;
      let detected = 0;
      
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);
        
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(messages.length/batchSize)} (${batch.length} messages)...`);
        
        const results = await this.extractor.processBatch(batch, 3);
        
        processed += batch.length;
        detected += results.length;
        
        // Log progress
        if (results.length > 0) {
          console.log(`  Found ${results.length} ticker detections:`);
          results.forEach(detection => {
            console.log(`    ${detection.ticker} (${detection.detection_confidence.toFixed(2)})`);
          });
        }
        
        // Progress indicator
        const progress = ((processed / messages.length) * 100).toFixed(1);
        console.log(`  Progress: ${processed}/${messages.length} (${progress}%)`);
        
        // Small delay between batches
        if (i + batchSize < messages.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log(`\n✅ Batch processing complete!`);
      console.log(`📊 Processed: ${processed} messages`);
      console.log(`🎯 Detected: ${detected} ticker mentions`);
      
      // Show summary of detected tickers
      await this.showTickerSummary();
      
    } catch (error) {
      console.error('Error in batch processing:', error);
    }
  }

  async clearTodaysTickers() {
    try {
      const result = await this.pool.query(`
        DELETE FROM stocks 
        WHERE first_mention_timestamp >= CURRENT_DATE
      `);
      console.log(`Cleared ${result.rowCount} existing ticker records from today`);
    } catch (error) {
      console.error('Error clearing today\'s tickers:', error);
    }
  }

  async showTickerSummary() {
    try {
      const result = await this.pool.query(`
        SELECT 
          ticker,
          exchange,
          mention_count,
          detection_confidence,
          ai_confidence,
          is_genuine_stock,
          first_mention_timestamp
        FROM stocks 
        WHERE first_mention_timestamp >= CURRENT_DATE
        AND is_genuine_stock = true
        ORDER BY mention_count DESC, detection_confidence DESC
        LIMIT 20
      `);
      
      if (result.rows.length > 0) {
        console.log('\n📈 Top Detected Tickers Today:');
        console.log('═'.repeat(80));
        console.log('TICKER  | EXCHANGE | MENTIONS | CONFIDENCE | AI_CONF | FIRST_SEEN');
        console.log('─'.repeat(80));
        
        result.rows.forEach(row => {
          const time = new Date(row.first_mention_timestamp).toLocaleTimeString();
          const aiConf = row.ai_confidence ? row.ai_confidence.toFixed(2) : 'N/A';
          console.log(
            `${row.ticker.padEnd(7)} | ${row.exchange.padEnd(8)} | ${String(row.mention_count).padEnd(8)} | ${row.detection_confidence.toFixed(2).padEnd(10)} | ${aiConf.padEnd(7)} | ${time}`
          );
        });
        console.log('═'.repeat(80));
      } else {
        console.log('\n📭 No valid tickers detected today');
      }
    } catch (error) {
      console.error('Error showing ticker summary:', error);
    }
  }

  async processDateRange(startDate, endDate) {
    console.log(`🔄 Processing messages from ${startDate} to ${endDate}...`);
    
    try {
      const result = await this.pool.query(`
        SELECT id, content, author_id, timestamp
        FROM discord_messages 
        WHERE timestamp >= $1 AND timestamp < $2
        ORDER BY timestamp ASC
      `, [startDate, endDate]);
      
      const messages = result.rows;
      console.log(`Found ${messages.length} messages in date range`);
      
      if (messages.length === 0) {
        console.log('No messages to process');
        return;
      }
      
      // Process in batches
      const results = await this.extractor.processBatch(messages, 3);
      
      console.log(`✅ Processed ${messages.length} messages, found ${results.length} ticker detections`);
      
      return results;
    } catch (error) {
      console.error('Error processing date range:', error);
      return [];
    }
  }

  async close() {
    await this.extractor.close();
    await this.pool.end();
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const extractor = new BatchExtractor();
  
  try {
    if (args.length === 0) {
      // Default: process today's messages
      await extractor.processTodaysMessages();
    } else if (args[0] === 'today') {
      await extractor.processTodaysMessages();
    } else if (args[0] === 'date' && args.length === 3) {
      // Process specific date range: node batch-extractor.js date 2025-08-14 2025-08-15
      await extractor.processDateRange(args[1], args[2]);
    } else {
      console.log('Usage:');
      console.log('  node batch-extractor.js                    # Process today\'s messages');
      console.log('  node batch-extractor.js today              # Process today\'s messages');
      console.log('  node batch-extractor.js date YYYY-MM-DD YYYY-MM-DD  # Process date range');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await extractor.close();
  }
}

// If run directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = BatchExtractor;
