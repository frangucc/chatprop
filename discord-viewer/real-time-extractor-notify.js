#!/usr/bin/env node

// Real-time ticker extractor using PostgreSQL LISTEN/NOTIFY
const TickerExtractor = require('./lib/ticker-extractor');
const TickerWebSocketServer = require('./lib/websocket-server');
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

class RealTimeExtractorNotify {
  constructor() {
    this.extractor = new TickerExtractor(
      process.env.DATABASE2_URL,
      process.env.ANTHROPIC_API_KEY
    );
    
    this.wsServer = null;
    this.listenClient = null;
  }

  async initialize() {
    console.log('🚀 Real-time ticker extractor (NOTIFY) starting...');
    
    // Initialize the ticker extractor with blacklist
    await this.extractor.initialize();
    
    // Set up LISTEN client
    this.listenClient = new Client({
      connectionString: process.env.DATABASE2_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    await this.listenClient.connect();
    
    // Set up LISTEN handlers
    this.listenClient.on('notification', async (msg) => {
      if (msg.channel === 'new_message') {
        await this.handleNewMessage(JSON.parse(msg.payload));
      } else if (msg.channel === 'ticker_detected') {
        await this.handleTickerDetected(JSON.parse(msg.payload));
      }
    });
    
    // Listen to channels
    await this.listenClient.query('LISTEN new_message');
    await this.listenClient.query('LISTEN ticker_detected');
    
    console.log('👂 Listening for database notifications...');
  }

  async handleNewMessage(message) {
    try {
      console.log(`[${new Date().toLocaleTimeString()}] New message from ${message.author_id}`);
      
      // Get author name
      const authorResult = await this.extractor.pool.query(
        'SELECT username FROM authors WHERE id = $1',
        [message.author_id]
      );
      const authorName = authorResult.rows[0]?.username || message.author_id;
      
      // Process message for tickers
      const detections = await this.extractor.processSingleMessage(
        message.id,
        message.content,
        authorName,
        message.timestamp
      );
      
      // Log detections
      for (const detection of detections) {
        console.log(`  ✅ Detected ticker: ${detection.ticker} (confidence: ${detection.detection_confidence.toFixed(2)})`);
      }
      
    } catch (error) {
      console.error(`Error processing message ${message.id}:`, error);
    }
  }

  async handleTickerDetected(detection) {
    // Trigger WebSocket update for new ticker
    if (this.wsServer) {
      await this.wsServer.triggerTickerUpdate(detection.ticker);
      console.log(`  📡 WebSocket update sent for ${detection.ticker}`);
    }
  }

  setWebSocketServer(wsServer) {
    this.wsServer = wsServer;
  }

  async close() {
    if (this.listenClient) {
      await this.listenClient.end();
    }
    await this.extractor.close();
    console.log('⏹️ Real-time extractor stopped');
  }
}

// If run directly
if (require.main === module) {
  const extractor = new RealTimeExtractorNotify();
  
  const gracefulShutdown = async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await extractor.close();
    process.exit(0);
  };
  
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  
  extractor.initialize().catch(console.error);
}

module.exports = RealTimeExtractorNotify;
