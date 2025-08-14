const WebSocket = require('ws');
const { Pool } = require('pg');

class TickerWebSocketServer {
  constructor(server, databaseUrl) {
    this.clients = new Set();
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    // Create WebSocket server
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws',
      perMessageDeflate: false
    });
    
    this.setupWebSocket();
    this.setupDatabaseListener();
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log('Client connected to ticker WebSocket');
      this.clients.add(ws);
      
      // Send current tickers on connection
      this.sendCurrentTickers(ws);
      
      ws.on('close', () => {
        console.log('Client disconnected from ticker WebSocket');
        this.clients.delete(ws);
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  async setupDatabaseListener() {
    try {
      // Listen for ticker updates
      const client = await this.pool.connect();
      
      await client.query('LISTEN ticker_updates');
      
      client.on('notification', async (msg) => {
        if (msg.channel === 'ticker_updates') {
          try {
            const payload = JSON.parse(msg.payload);
            await this.broadcastTickerUpdate(payload);
          } catch (error) {
            console.error('Error processing ticker notification:', error);
          }
        }
      });
      
      console.log('Database listener setup for ticker updates');
    } catch (error) {
      console.error('Error setting up database listener:', error);
    }
  }

  async sendCurrentTickers(ws) {
    try {
      const result = await this.pool.query(`
        SELECT 
          ticker,
          exchange,
          mention_count,
          detection_confidence,
          ai_confidence,
          first_mention_timestamp,
          first_mention_author,
          is_genuine_stock
        FROM stocks 
        WHERE is_genuine_stock = true 
        AND detection_confidence >= 0.70
        ORDER BY mention_count DESC, first_mention_timestamp DESC
        LIMIT 50
      `);
      
      const message = {
        type: 'initial_tickers',
        data: result.rows
      };
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('Error sending current tickers:', error);
    }
  }

  async broadcastTickerUpdate(tickerData) {
    const message = {
      type: 'ticker_update',
      data: tickerData,
      timestamp: new Date().toISOString()
    };
    
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
    
    console.log(`Broadcasted ticker update: ${tickerData.ticker}`);
  }

  // Manual trigger for ticker updates
  async triggerTickerUpdate(ticker) {
    try {
      const result = await this.pool.query(`
        SELECT 
          ticker,
          exchange,
          mention_count,
          detection_confidence,
          ai_confidence,
          first_mention_timestamp,
          first_mention_author,
          is_genuine_stock
        FROM stocks 
        WHERE ticker = $1
      `, [ticker]);
      
      if (result.rows.length > 0) {
        await this.broadcastTickerUpdate(result.rows[0]);
      }
    } catch (error) {
      console.error('Error triggering ticker update:', error);
    }
  }

  close() {
    this.wss.close();
    this.pool.end();
  }
}

module.exports = TickerWebSocketServer;
