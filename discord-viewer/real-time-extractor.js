#!/usr/bin/env node

// Real-time ticker extractor - processes messages as they come in
const TickerExtractor = require('./lib/ticker-extractor');
const TickerWebSocketServer = require('./lib/websocket-server');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

class RealTimeExtractor {
  constructor() {
    this.extractor = new TickerExtractor(
      process.env.DATABASE_URL,
      process.env.ANTHROPIC_API_KEY
    );
    
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    this.wsServer = null;
    this.lastProcessedId = null;
    this.isProcessing = false;
  }

  async initialize() {
    console.log('🚀 Real-time ticker extractor starting...');
    
    // Initialize the ticker extractor with blacklist
    await this.extractor.initialize();
    
    // Get the last processed message ID
    try {
      const result = await this.pool.query(`
        SELECT MAX(id) as last_id FROM discord_messages 
        WHERE timestamp >= CURRENT_DATE
      `);
      this.lastProcessedId = result.rows[0]?.last_id || null;
      console.log(`Starting from message ID: ${this.lastProcessedId || 'beginning'}`);
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
        SELECT id, content, author_id, author_name, timestamp 
        FROM discord_messages 
        WHERE timestamp >= CURRENT_DATE
      `;
      
      const params = [];
      if (this.lastProcessedId) {
        query += ` AND id > $1`;
        params.push(this.lastProcessedId);
      }
      
      query += ` ORDER BY timestamp ASC LIMIT 10`;
      
      const result = await this.pool.query(query, params);
      
      if (result.rows.length > 0) {
        console.log(`[${new Date().toLocaleTimeString()}] Processing ${result.rows.length} new messages...`);
        
        for (const message of result.rows) {
          try {
            const detections = await this.extractor.processSingleMessage(
              message.id,
              message.content,
              message.author_name || message.author_id,
              message.timestamp
            );
            
            // Trigger WebSocket updates for new tickers
            for (const detection of detections) {
              if (this.wsServer) {
                await this.wsServer.triggerTickerUpdate(detection.ticker);
              }
              console.log(`  ✅ Detected ticker: ${detection.ticker} (confidence: ${detection.detection_confidence.toFixed(2)})`);
            }
            
            this.lastProcessedId = message.id;
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
