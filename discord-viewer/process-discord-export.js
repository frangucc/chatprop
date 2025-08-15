#!/usr/bin/env node

/**
 * Discord Chat Export Processor
 * Processes JSON exports from DiscordChatExporter into the new database
 */

const fs = require('fs').promises;
const path = require('path');
const DatabaseClient = require('./database-v2/db-client');
const TickerExtractorV3 = require('./ticker-extractor-v3');

// Use the new clean database
const DATABASE_URL = process.env.DATABASE2_URL || 
  'postgresql://neondb_owner:npg_Z7txvpsw2TIG@ep-dawn-bird-aeah6d7i-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

class DiscordExportProcessor {
  constructor() {
    this.db = new DatabaseClient(DATABASE_URL);
    this.extractor = new TickerExtractorV3(DATABASE_URL, process.env.ANTHROPIC_API_KEY);
    
    this.stats = {
      filesProcessed: 0,
      messagesProcessed: 0,
      tickersDetected: 0,
      errors: 0
    };
  }

  async initialize() {
    console.log('🚀 Initializing Discord Export Processor...\n');
    await this.extractor.initialize();
  }

  async processExportFile(filePath) {
    console.log(`\n📁 Processing: ${path.basename(filePath)}`);
    console.log('━'.repeat(50));
    
    // Read and parse the export file
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    
    // Extract metadata
    const guildName = data.guild?.name || 'Unknown Server';
    const channelName = data.channel?.name || 'Unknown Channel';
    const channelId = data.channel?.id;
    const guildId = data.guild?.id;
    
    console.log(`📍 Server: ${guildName}`);
    console.log(`📍 Channel: #${channelName}`);
    console.log(`📬 Messages: ${data.messages?.length || 0}`);
    
    if (!data.messages || data.messages.length === 0) {
      console.log('⚠️  No messages found in export');
      return;
    }
    
    // Set up guild and channel
    if (guildId) {
      await this.db.pool.query(
        'INSERT INTO guilds (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = $2',
        [guildId, guildName]
      );
    }
    
    if (channelId && guildId) {
      await this.db.pool.query(
        'INSERT INTO channels (id, guild_id, name, is_monitored) VALUES ($1, $2, $3, true) ON CONFLICT (id) DO UPDATE SET name = $3',
        [channelId, guildId, channelName]
      );
    }
    
    // Process messages
    const messages = data.messages.filter(msg => 
      msg.content && 
      msg.content.length > 2 &&
      msg.type === 'Default' // Skip system messages
    );
    
    console.log(`\n🔍 Processing ${messages.length} valid messages...`);
    
    const detectedTickers = new Map();
    let processedCount = 0;
    
    for (const msg of messages) {
      try {
        // Insert/update author
        await this.db.upsertAuthor({
          id: msg.author.id,
          username: msg.author.name || msg.author.nickname,
          discriminator: msg.author.discriminator,
          isBot: msg.author.isBot || false,
          avatarUrl: msg.author.avatarUrl
        });
        
        // Insert message
        await this.db.insertMessage({
          id: msg.id,
          channelId: channelId,
          authorId: msg.author.id,
          content: msg.content,
          timestamp: new Date(msg.timestamp),
          type: msg.type,
          isEdited: msg.isEdited || false,
          hasAttachments: msg.attachments?.length > 0,
          hasEmbeds: msg.embeds?.length > 0
        });
        
        // Process for tickers
        const detections = await this.extractor.processMessage({
          id: msg.id,
          content: msg.content,
          author_id: msg.author.id,
          discord_timestamp: new Date(msg.timestamp),
          author_name: msg.author.name || msg.author.nickname
        });
        
        for (const detection of detections) {
          const count = detectedTickers.get(detection.ticker_symbol) || 0;
          detectedTickers.set(detection.ticker_symbol, count + 1);
          this.stats.tickersDetected++;
        }
        
        processedCount++;
        this.stats.messagesProcessed++;
        
        // Progress update every 100 messages
        if (processedCount % 100 === 0) {
          process.stdout.write(`\r  Processed: ${processedCount}/${messages.length} messages`);
        }
        
      } catch (error) {
        console.error(`\n❌ Error processing message ${msg.id}:`, error.message);
        this.stats.errors++;
      }
    }
    
    console.log(`\n✅ Processed ${processedCount} messages`);
    
    // Show detected tickers
    if (detectedTickers.size > 0) {
      console.log('\n📈 Tickers Detected:');
      const sorted = Array.from(detectedTickers.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
      
      for (const [ticker, count] of sorted) {
        console.log(`   ${ticker}: ${count} mentions`);
      }
    }
    
    this.stats.filesProcessed++;
    console.log('━'.repeat(50));
  }

  async processExportsFolder(folderPath = '/Users/franckjones/chatprop/exports') {
    console.log(`📂 Scanning exports folder: ${folderPath}\n`);
    
    const files = await fs.readdir(folderPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
      console.log('⚠️  No JSON export files found');
      console.log('\nTo export Discord messages:');
      console.log('1. Use DiscordChatExporter-CLI');
      console.log('2. Export as JSON format');
      console.log('3. Place files in /exports folder');
      return;
    }
    
    console.log(`Found ${jsonFiles.length} export file(s)\n`);
    
    for (const file of jsonFiles) {
      await this.processExportFile(path.join(folderPath, file));
    }
    
    // Update daily statistics
    await this.db.updateDailyStats();
    
    // Show final summary
    await this.showSummary();
  }

  async showSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 PROCESSING SUMMARY');
    console.log('='.repeat(50));
    console.log(`Files processed: ${this.stats.filesProcessed}`);
    console.log(`Messages processed: ${this.stats.messagesProcessed}`);
    console.log(`Ticker detections: ${this.stats.tickersDetected}`);
    
    if (this.stats.errors > 0) {
      console.log(`Errors: ${this.stats.errors}`);
    }
    
    // Get today's top tickers
    const topTickers = await this.db.getTodaysTickers({ minConfidence: 0.7 });
    
    if (topTickers.length > 0) {
      console.log('\n🏆 TOP TICKERS TODAY:');
      console.log('━'.repeat(50));
      
      for (const ticker of topTickers.slice(0, 10)) {
        const confidence = (ticker.avg_confidence * 100).toFixed(0);
        console.log(
          `${ticker.symbol.padEnd(6)} | ` +
          `${ticker.mention_count} mentions | ` +
          `${ticker.unique_authors} authors | ` +
          `${confidence}% confidence`
        );
      }
    }
    
    console.log('='.repeat(50));
  }

  async exportTodaysData() {
    // Export today's tickers to CSV for analysis
    const tickers = await this.db.getTodaysTickers({ minConfidence: 0.5 });
    
    const csv = [
      'Ticker,Exchange,Mentions,UniqueAuthors,AvgConfidence,FirstMention,LastMention',
      ...tickers.map(t => 
        `${t.symbol},${t.exchange},${t.mention_count},${t.unique_authors},` +
        `${t.avg_confidence},${t.first_mention},${t.last_mention}`
      )
    ].join('\n');
    
    const outputPath = `/Users/franckjones/chatprop/discord-viewer/output/tickers-${new Date().toISOString().split('T')[0]}.csv`;
    await fs.writeFile(outputPath, csv);
    console.log(`\n📄 Exported ticker data to: ${outputPath}`);
  }

  async close() {
    await this.extractor.close();
    await this.db.close();
  }
}

// Main execution
async function main() {
  const processor = new DiscordExportProcessor();
  
  try {
    await processor.initialize();
    
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (command === '--help' || command === '-h') {
      console.log(`
Discord Export Processor
━━━━━━━━━━━━━━━━━━━━━━━━

USAGE:
  node process-discord-export.js [options]

OPTIONS:
  --folder <path>   Process all JSON files in folder (default: /exports)
  --file <path>     Process a specific JSON export file
  --export          Export today's ticker data to CSV
  --help            Show this help

EXAMPLES:
  # Process all exports in default folder
  node process-discord-export.js

  # Process specific file
  node process-discord-export.js --file /path/to/export.json

  # Process and export
  node process-discord-export.js --export

NOTES:
  - Expects JSON format from DiscordChatExporter
  - Automatically extracts and validates tickers
  - Uses the new clean database architecture
      `);
      return;
    }
    
    if (command === '--file' && args[1]) {
      await processor.processExportFile(args[1]);
    } else if (command === '--folder' && args[1]) {
      await processor.processExportsFolder(args[1]);
    } else {
      // Default: process exports folder
      await processor.processExportsFolder();
    }
    
    if (args.includes('--export')) {
      await processor.exportTodaysData();
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

module.exports = DiscordExportProcessor;
