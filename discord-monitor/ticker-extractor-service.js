#!/usr/bin/env node

// Standalone ticker extraction service
// Monitors the messages table and extracts tickers in real-time
const TickerExtractorV3 = require('../discord-viewer/ticker-extractor-v3');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

class TickerExtractionService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE2_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    this.extractor = new TickerExtractorV3(process.env.DATABASE2_URL, process.env.ANTHROPIC_API_KEY);
    this.lastProcessedTs = null;
    this.isProcessing = false;
    this.checkInterval = 5000; // Check every 5 seconds
  }

  async initialize() {
    console.log('🚀 Ticker extraction service starting...');
    
    // Initialize the extractor with blacklist
    await this.extractor.initialize();
    
    // Get the last processed timestamp from ticker_detections/messages
    try {
      const result = await this.pool.query(`
        SELECT COALESCE(MAX(m.discord_timestamp), NOW() - INTERVAL '24 hours') AS last_ts
        FROM ticker_detections td
        JOIN messages m ON m.id = td.message_id
      `);
      this.lastProcessedTs = result.rows[0]?.last_ts || null;
      console.log(`Resuming from timestamp: ${this.lastProcessedTs || '24h ago'}`);
    } catch (error) {
      console.error('Error getting last processed ID:', error);
      // Start from messages in the last hour on error
      this.lastProcessedTs = null;
    }
  }

  async processNewMessages() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      // Get unprocessed messages
      let query = `
        SELECT m.id, m.content, m.author_id, a.username as author_name,
               m.discord_timestamp, m.channel_id
        FROM messages m
        JOIN authors a ON m.author_id = a.id
        WHERE m.content IS NOT NULL AND m.content != ''
      `;

      const params = [];
      if (this.lastProcessedTs) {
        query += ` AND m.discord_timestamp > $1`;
        params.push(this.lastProcessedTs);
      } else {
        query += ` AND m.discord_timestamp >= NOW() - INTERVAL '24 hours'`;
      }

      query += ` ORDER BY m.discord_timestamp ASC LIMIT 50`;
      
      const result = await this.pool.query(query, params);
      
      if (result.rows.length > 0) {
        console.log(`[${new Date().toLocaleTimeString()}] Processing ${result.rows.length} new messages...`);
        
        for (const message of result.rows) {
          try {
            // Extract tickers from the message
            const tickers = await this.extractor.processMessage(message);
            
            if (tickers.length > 0) {
              // Process and insert ticker detections
              for (const ticker of tickers) {
                await this.pool.query(`
                  INSERT INTO ticker_detections 
                  (message_id, ticker_symbol, detection_method, confidence_score, 
                   context_strength, position_in_message, detected_text)
                  VALUES ($1, $2, $3, $4, $5, $6, $7)
                  ON CONFLICT (message_id, ticker_symbol, position_in_message) DO NOTHING
                `, [
                  ticker.message_id,
                  ticker.ticker_symbol,
                  ticker.detection_method,
                  ticker.confidence_score,
                  ticker.context_strength,
                  ticker.position_in_message,
                  ticker.detected_text
                ]);
                
                console.log(`  ✅ Detected ticker: ${ticker.ticker_symbol} in message ${message.id}`);
              }
            }
            
            this.lastProcessedTs = message.discord_timestamp;
          } catch (error) {
            console.error(`Error processing message ${message.id}:`, error.message);
          }
        }
        console.log(`Processed up to timestamp: ${this.lastProcessedTs}`);
      }
    } catch (error) {
      console.error('Error processing messages:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  start() {
    console.log('🔄 Starting ticker extraction service...');
    
    // Process immediately
    this.processNewMessages();
    
    // Then check periodically
    this.interval = setInterval(() => {
      this.processNewMessages();
    }, this.checkInterval);
  }

  async stop() {
    console.log('⏹️ Stopping ticker extraction service...');
    
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    // Wait for current processing to finish
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await this.pool.end();
    console.log('✅ Ticker extraction service stopped');
  }
}

// Run the service
if (require.main === module) {
  const service = new TickerExtractionService();
  
  // Graceful shutdown handlers
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    await service.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  // Start the service
  service.initialize()
    .then(() => service.start())
    .catch(error => {
      console.error('Failed to start ticker extraction service:', error);
      process.exit(1);
    });
}

module.exports = TickerExtractionService;
