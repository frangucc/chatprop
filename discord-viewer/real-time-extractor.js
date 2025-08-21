#!/usr/bin/env node

// Real-time ticker extractor - processes messages as they come in
const TickerExtractor = require('./lib/ticker-extractor');
const TickerWebSocketServer = require('./lib/websocket-server');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

class RealTimeExtractor {
  constructor() {
    this.extractor = new TickerExtractor(
      process.env.DATABASE2_URL,
      process.env.ANTHROPIC_API_KEY
    );
    
    this.pool = new Pool({
      connectionString: process.env.DATABASE2_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    this.wsServer = null;
    this.lastProcessedTimestamp = null;
    this.isProcessing = false;
  }

  async initialize() {
    console.log('🚀 Real-time ticker extractor starting...');
    
    // Initialize the ticker extractor with blacklist
    await this.extractor.initialize();
    
    // Get the last processed message timestamp for today (Chicago time)
    try {
      const result = await this.pool.query(`
        SELECT MAX(discord_timestamp) AS last_ts
        FROM messages 
        WHERE discord_timestamp >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago')
      `);
      this.lastProcessedTimestamp = result.rows[0]?.last_ts || null;
      console.log(`Starting from timestamp: ${this.lastProcessedTimestamp || 'beginning of today'}`);
    } catch (error) {
      console.error('Error getting last processed ID:', error);
    }
  }

  async processNewMessages() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      // Get new messages since last check
      let query = `
        SELECT m.id AS message_id,
               m.content,
               m.author_id,
               a.username AS author_name,
               m.discord_timestamp AS ts
        FROM messages m
        JOIN authors a ON m.author_id = a.id
        WHERE m.discord_timestamp >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago')
      `;

      const params = [];
      if (this.lastProcessedTimestamp) {
        query += ` AND m.discord_timestamp > $1`;
        params.push(this.lastProcessedTimestamp);
      }

      query += ` ORDER BY ts ASC LIMIT 10`;

      const result = await this.pool.query(query, params);
      
      if (result.rows.length > 0) {
        console.log(`[${new Date().toLocaleTimeString()}] Processing ${result.rows.length} new messages...`);
        
        for (const message of result.rows) {
          try {
            const detections = await this.extractor.processSingleMessage(
              message.message_id,
              message.content,
              message.author_name || message.author_id,
              message.ts
            );
            
            // Trigger WebSocket updates for new tickers
            for (const detection of detections) {
              if (this.wsServer) {
                await this.wsServer.triggerTickerUpdate(detection.ticker);
              }
              console.log(`  ✅ Detected ticker: ${detection.ticker} (confidence: ${detection.detection_confidence.toFixed(2)})`);
            }
            
            this.lastProcessedTimestamp = message.ts;
          } catch (error) {
            console.error(`Error processing message ${message.id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error processing new messages:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  setWebSocketServer(wsServer) {
    this.wsServer = wsServer;
  }

  start() {
    console.log('🔄 Starting real-time message processing...');
    
    // Process immediately
    this.processNewMessages();
    
    // Then check every 10 seconds
    this.interval = setInterval(() => {
      this.processNewMessages();
    }, 10000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('⏹️ Real-time extractor stopped');
  }

  async close() {
    this.stop();
    await this.extractor.close();
    await this.pool.end();
  }
}

// If run directly
if (require.main === module) {
  const extractor = new RealTimeExtractor();
  
  const gracefulShutdown = async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await extractor.close();
    process.exit(0);
  };
  
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  
  extractor.initialize().then(() => {
    extractor.start();
  }).catch(console.error);
}

module.exports = RealTimeExtractor;
