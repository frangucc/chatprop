#!/usr/bin/env node

/**
 * Smart Message Processor v2
 * 
 * This script provides intelligent reprocessing of Discord messages with:
 * - Proper deduplication (no double counting)
 * - Contextual disambiguation for blacklisted words
 * - Progress tracking and reporting
 * - Options for clean vs incremental processing
 */

const TickerExtractorV2 = require('./lib/ticker-extractor-v2');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

class MessageProcessor {
  constructor() {
    this.extractor = new TickerExtractorV2(
      process.env.DATABASE_URL,
      process.env.ANTHROPIC_API_KEY
    );
    
    this.stats = {
      messagesProcessed: 0,
      tickersFound: 0,
      blacklistedSkipped: 0,
      errors: 0,
      startTime: null,
      endTime: null
    };
  }

  async initialize() {
    console.log('🚀 Initializing Message Processor v2...\n');
    await this.extractor.initialize();
    
    // Show current state
    await this.showCurrentState();
  }

  async showCurrentState() {
    console.log('📊 Current Database State:');
    console.log('━'.repeat(50));
    
    // Get message count for today
    const msgResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM discord_messages 
      WHERE timestamp >= CURRENT_DATE
    `);
    console.log(`📬 Messages today: ${msgResult.rows[0].count}`);
    
    // Get current ticker stats
    const tickerResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT ticker) as unique_tickers,
        COUNT(*) as total_mentions
      FROM ticker_mentions
      WHERE detected_at >= CURRENT_DATE
    `);
    console.log(`📈 Unique tickers detected: ${tickerResult.rows[0].unique_tickers}`);
    console.log(`🔢 Total mentions tracked: ${tickerResult.rows[0].total_mentions}`);
    
    // Get blacklist count
    const blacklistResult = await pool.query(`
      SELECT COUNT(*) as count FROM ticker_blacklist
    `);
    console.log(`🚫 Blacklisted tickers: ${blacklistResult.rows[0].count}`);
    
    console.log('━'.repeat(50) + '\n');
  }

  async processToday(options = {}) {
    const {
      mode = 'incremental',  // 'incremental' or 'clean'
      dryRun = false,
      verbose = true
    } = options;
    
    console.log(`🔄 Processing Mode: ${mode.toUpperCase()}`);
    if (dryRun) console.log('⚠️  DRY RUN - No changes will be saved\n');
    
    this.stats.startTime = new Date();
    
    // Handle clean mode
    if (mode === 'clean' && !dryRun) {
      console.log('🧹 Cleaning existing detections for today...');
      await this.cleanTodaysData();
      console.log('✅ Cleaned existing data\n');
    }
    
    // Get messages to process
    const messages = await this.getMessagesToProcess(mode);
    console.log(`📝 Found ${messages.length} messages to process\n`);
    
    if (messages.length === 0) {
      console.log('✨ No new messages to process!');
      return;
    }
    
    // Process messages with progress bar
    console.log('Processing messages...');
    console.log('━'.repeat(50));
    
    const batchSize = 50;
    const tickersFound = new Map(); // Track unique tickers found
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      
      for (const message of batch) {
        try {
          if (!dryRun) {
            const detections = await this.extractor.processSingleMessage(
              message.id,
              message.content,
              message.author_id,
              message.timestamp,
              message.author_name
            );
            
            for (const detection of detections) {
              tickersFound.set(detection.ticker, 
                (tickersFound.get(detection.ticker) || 0) + 1
              );
              this.stats.tickersFound++;
            }
          }
          
          this.stats.messagesProcessed++;
        } catch (error) {
          if (verbose) {
            console.error(`❌ Error processing message ${message.id}:`, error.message);
          }
          this.stats.errors++;
        }
      }
      
      // Show progress
      const progress = Math.round((i + batch.length) / messages.length * 100);
      const progressBar = this.createProgressBar(progress);
      process.stdout.write(`\r${progressBar} ${progress}% (${i + batch.length}/${messages.length})`);
    }
    
    console.log('\n' + '━'.repeat(50) + '\n');
    
    // Update mention counts if not dry run
    if (!dryRun) {
      console.log('📊 Updating mention counts...');
      await pool.query('SELECT update_ticker_mention_counts()');
    }
    
    this.stats.endTime = new Date();
    
    // Show results
    await this.showResults(tickersFound, dryRun);
  }

  async cleanTodaysData() {
    // Remove today's mentions
    await pool.query(`
      DELETE FROM ticker_mentions 
      WHERE detected_at >= CURRENT_DATE
    `);
    
    // Reset mention counts for today
    await pool.query(`
      UPDATE stocks 
      SET mention_count = 0,
          unique_authors = 0
      WHERE first_mention_timestamp >= CURRENT_DATE
    `);
  }

  async getMessagesToProcess(mode) {
    let query;
    
    if (mode === 'incremental') {
      // Get only unprocessed messages
      query = `
        SELECT DISTINCT
          dm.id, 
          dm.content, 
          dm.author_id, 
          dm.author_name, 
          dm.timestamp
        FROM discord_messages dm
        LEFT JOIN ticker_mentions tm ON dm.id = tm.message_id
        WHERE dm.timestamp >= CURRENT_DATE
        AND tm.id IS NULL
        AND dm.content IS NOT NULL
        AND LENGTH(dm.content) > 2
        ORDER BY dm.timestamp ASC
      `;
    } else {
      // Get all messages for today
      query = `
        SELECT 
          id, 
          content, 
          author_id, 
          author_name, 
          timestamp
        FROM discord_messages
        WHERE timestamp >= CURRENT_DATE
        AND content IS NOT NULL
        AND LENGTH(content) > 2
        ORDER BY timestamp ASC
      `;
    }
    
    const result = await pool.query(query);
    return result.rows;
  }

  createProgressBar(percentage) {
    const width = 40;
    const filled = Math.round(width * percentage / 100);
    const empty = width - filled;
    return `[${'\x1b[32m█\x1b[0m'.repeat(filled)}${' '.repeat(empty)}]`;
  }

  async showResults(tickersFound, dryRun) {
    console.log('📈 Processing Results:');
    console.log('━'.repeat(50));
    
    const duration = (this.stats.endTime - this.stats.startTime) / 1000;
    console.log(`⏱️  Duration: ${duration.toFixed(2)} seconds`);
    console.log(`📬 Messages processed: ${this.stats.messagesProcessed}`);
    console.log(`🎯 Ticker detections: ${this.stats.tickersFound}`);
    console.log(`📊 Unique tickers found: ${tickersFound.size}`);
    
    if (this.stats.errors > 0) {
      console.log(`❌ Errors encountered: ${this.stats.errors}`);
    }
    
    if (dryRun) {
      console.log('\n⚠️  DRY RUN - No changes were saved');
    }
    
    // Show top tickers found
    if (tickersFound.size > 0) {
      console.log('\n🏆 Top Tickers Found:');
      const sorted = Array.from(tickersFound.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      for (const [ticker, count] of sorted) {
        console.log(`   ${ticker}: ${count} mentions`);
      }
    }
    
    console.log('━'.repeat(50));
  }

  async showHelp() {
    console.log(`
📚 Message Processor v2 - Help
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USAGE:
  node process-messages-v2.js [command] [options]

COMMANDS:
  process    Process today's messages (default)
  status     Show current database status
  clean      Clean and reprocess all messages
  help       Show this help message

OPTIONS:
  --mode=<incremental|clean>
    incremental: Only process new messages (default)
    clean: Remove existing data and reprocess all

  --dry-run
    Preview what would happen without making changes

  --verbose
    Show detailed error messages

EXAMPLES:
  # Process only new messages
  node process-messages-v2.js process

  # Clean and reprocess everything
  node process-messages-v2.js process --mode=clean

  # Preview what would happen
  node process-messages-v2.js process --dry-run

  # Show current status
  node process-messages-v2.js status

NOTES:
  - Incremental mode only processes messages not yet analyzed
  - Clean mode removes all today's detections and starts fresh
  - The blacklist is always respected
  - Duplicate message-ticker pairs are automatically prevented
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  }

  async close() {
    await this.extractor.close();
    await pool.end();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'process';
  
  // Parse options
  const options = {};
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      options[key.replace(/-/g, '')] = value || true;
    }
  }
  
  const processor = new MessageProcessor();
  
  try {
    await processor.initialize();
    
    switch (command) {
      case 'help':
        await processor.showHelp();
        break;
        
      case 'status':
        // Status already shown in initialize
        break;
        
      case 'clean':
        options.mode = 'clean';
        await processor.processToday(options);
        break;
        
      case 'process':
      default:
        await processor.processToday(options);
        break;
    }
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await processor.close();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = MessageProcessor;
