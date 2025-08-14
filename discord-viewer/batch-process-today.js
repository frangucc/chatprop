#!/usr/bin/env node

// Batch process all messages from today
const TickerExtractor = require('./lib/ticker-extractor');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

class BatchProcessor {
  constructor() {
    this.extractor = new TickerExtractor(
      process.env.DATABASE_URL,
      process.env.ANTHROPIC_API_KEY
    );
    
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    this.stats = {
      totalMessages: 0,
      processedMessages: 0,
      newTickers: 0,
      errors: 0,
      startTime: new Date()
    };
  }

  async initialize() {
    console.log('🚀 Starting batch processing for today...');
    await this.extractor.initialize();
    console.log('✅ Extractor initialized with blacklist');
  }

  async getTodaysMessages() {
    try {
      const result = await this.pool.query(`
        SELECT id, content, author_id, author_name, timestamp 
        FROM discord_messages 
        WHERE timestamp >= CURRENT_DATE
        AND timestamp < CURRENT_DATE + INTERVAL '1 day'
        ORDER BY timestamp ASC
      `);
      
      this.stats.totalMessages = result.rows.length;
      console.log(`📊 Found ${this.stats.totalMessages} messages from today`);
      return result.rows;
    } catch (error) {
      console.error('Error fetching today\'s messages:', error);
      throw error;
    }
  }

  async processMessages(messages) {
    console.log('🔄 Processing messages in batches...');
    
    const batchSize = 10; // Process in small batches to avoid overwhelming the system
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      
      for (const message of batch) {
        try {
          const detections = await this.extractor.processSingleMessage(
            message.id,
            message.content,
            message.author_name || message.author_id,
            message.timestamp
          );
          
          if (detections && detections.length > 0) {
            this.stats.newTickers += detections.length;
            console.log(`✅ Found ${detections.length} ticker(s) in message ${message.id}`);
          }
          
          this.stats.processedMessages++;
          
          // Progress update every 50 messages
          if (this.stats.processedMessages % 50 === 0) {
            const progress = Math.round((this.stats.processedMessages / this.stats.totalMessages) * 100);
            console.log(`📈 Progress: ${progress}% (${this.stats.processedMessages}/${this.stats.totalMessages})`);
          }
          
        } catch (error) {
          console.error(`❌ Error processing message ${message.id}:`, error.message);
          this.stats.errors++;
        }
      }
      
      // Small delay between batches to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async run() {
    try {
      await this.initialize();
      
      const messages = await this.getTodaysMessages();
      if (messages.length === 0) {
        console.log('ℹ️ No messages found for today');
        return;
      }
      
      await this.processMessages(messages);
      
      const duration = Math.round((new Date() - this.stats.startTime) / 1000);
      console.log('\n🎉 Batch processing completed!');
      console.log(`📊 Statistics:`);
      console.log(`   Total messages: ${this.stats.totalMessages}`);
      console.log(`   Processed: ${this.stats.processedMessages}`);
      console.log(`   New tickers found: ${this.stats.newTickers}`);
      console.log(`   Errors: ${this.stats.errors}`);
      console.log(`   Duration: ${duration} seconds`);
      
    } catch (error) {
      console.error('💥 Batch processing failed:', error);
      process.exit(1);
    } finally {
      await this.pool.end();
    }
  }
}

// Run the batch processor
const processor = new BatchProcessor();
processor.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
