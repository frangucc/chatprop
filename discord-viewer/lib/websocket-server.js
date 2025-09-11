const WebSocket = require('ws');
const { Pool } = require('pg');

class TickerWebSocketServer {
  constructor(server, databaseUrl) {
    this.clients = new Set();
    this.priceData = new Map(); // Store latest prices from Rust service
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
    this.wss.on('connection', (ws, req) => {
      console.log('Client connected to ticker WebSocket from:', req.socket.remoteAddress);
      this.clients.add(ws);
      
      // Send current tickers on connection (only for frontend clients, not Rust service)
      if (req.headers['user-agent'] && !req.headers['user-agent'].includes('tokio')) {
        this.sendCurrentTickers(ws);
      }
      
      // Handle incoming messages (for price updates from Rust service)
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleIncomingMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });
      
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
          t.symbol as ticker,
          t.exchange,
          COUNT(DISTINCT td.message_id) as mention_count,
          AVG(td.confidence_score) as detection_confidence,
          MIN(m.discord_timestamp) as first_mention_timestamp,
          MAX(m.discord_timestamp) as last_mention_timestamp,
          -- Surge metrics
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '5 minutes') as mentions_5min,
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '15 minutes') as mentions_15min,
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '30 minutes') as mentions_30min,
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '1 hour') as mentions_1hr,
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '4 hours') as mentions_4hr,
          (
            SELECT a.username
            FROM ticker_detections td2
            JOIN messages m2 ON td2.message_id = m2.id
            JOIN authors a ON m2.author_id = a.id
            WHERE td2.ticker_symbol = t.symbol
            ORDER BY m2.discord_timestamp ASC
            LIMIT 1
          ) as first_mention_author
        FROM tickers t
        JOIN ticker_detections td ON t.symbol = td.ticker_symbol
        JOIN messages m ON td.message_id = m.id
        LEFT JOIN ticker_blacklist bl ON t.symbol = bl.ticker
        WHERE td.confidence_score >= 0.70
        AND (bl.ticker IS NULL OR NOT bl.is_permanent)
        AND m.discord_timestamp >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago'
        GROUP BY t.symbol, t.exchange
        ORDER BY mention_count DESC, first_mention_timestamp DESC
        LIMIT 50
      `);
      
      // Process results to include surge calculations
      const processedData = result.rows.map(row => {
        const mentions5min = parseInt(row.mentions_5min) || 0;
        const mentions15min = parseInt(row.mentions_15min) || 0;
        const mentions30min = parseInt(row.mentions_30min) || 0;
        const mentions1hr = parseInt(row.mentions_1hr) || 0;
        const mentions4hr = parseInt(row.mentions_4hr) || 0;
        
        // Calculate surge rates (mentions per minute for each window)
        const surgeRates = {
          '5min': mentions5min / 5,
          '15min': mentions15min / 15,
          '30min': mentions30min / 30,
          '1hr': mentions1hr / 60
        };
        
        // Find the best surge rate and its time window
        const bestSurgeEntry = Object.entries(surgeRates).reduce((best, [window, rate]) => 
          rate > best[1] ? [window, rate] : best
        );
        
        const [bestWindow, bestSurgeRate] = bestSurgeEntry;
        
        // Calculate time since last mention in hours
        const hoursSinceLastMention = row.last_mention_timestamp ? 
          (Date.now() - new Date(row.last_mention_timestamp).getTime()) / (1000 * 60 * 60) : Infinity;

        return {
          ...row,
          surge: {
            mentions5min,
            mentions15min, 
            mentions30min,
            mentions1hr,
            mentions4hr,
            bestRate: bestSurgeRate,
            bestWindow: bestWindow,
            hoursSinceLastMention
          }
        };
      });

      const message = {
        type: 'initial_tickers',
        data: processedData
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
          t.symbol as ticker,
          t.exchange,
          COUNT(DISTINCT td.message_id) as mention_count,
          AVG(td.confidence_score) as detection_confidence,
          MIN(m.discord_timestamp) as first_mention_timestamp,
          (
            SELECT a.username
            FROM ticker_detections td2
            JOIN messages m2 ON td2.message_id = m2.id
            JOIN authors a ON m2.author_id = a.id
            WHERE td2.ticker_symbol = t.symbol
            ORDER BY m2.discord_timestamp ASC
            LIMIT 1
          ) as first_mention_author
        FROM tickers t
        JOIN ticker_detections td ON t.symbol = td.ticker_symbol
        JOIN messages m ON td.message_id = m.id
        WHERE t.symbol = $1
        GROUP BY t.symbol, t.exchange
      `, [ticker]);
      
      if (result.rows.length > 0) {
        await this.broadcastTickerUpdate(result.rows[0]);
      }
    } catch (error) {
      console.error('Error triggering ticker update:', error);
    }
  }

  // Handle incoming messages from clients (including Rust service)
  handleIncomingMessage(message) {
    // Check if this is a price update from the Rust service
    if (message.symbol && message.price && message.timestamp) {
      this.handlePriceUpdate(message);
    }
  }

  // Handle price updates from Rust service
  handlePriceUpdate(priceUpdate) {
    const { symbol, price, timestamp } = priceUpdate;
    
    // Store the latest price
    this.priceData.set(symbol, {
      price: price,
      timestamp: timestamp,
      lastUpdated: new Date().toISOString()
    });
    
    // Broadcast to all connected frontend clients
    this.broadcastPriceUpdate({
      type: 'live_price',
      symbol: symbol,
      price: price,
      timestamp: timestamp,
      source: 'databento'
    });
    
    console.log(`Updated live price: ${symbol} @ $${price.toFixed(4)}`);
  }

  // Broadcast live price updates from Rust service
  broadcastPriceUpdate(priceData) {
    const message = {
      type: 'live_price',
      data: priceData,
      timestamp: new Date().toISOString()
    };
    
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
    
    console.log(`Broadcasted live price: ${priceData.symbol} @ $${priceData.price}`);
  }

  // Get current prices for a symbol or all symbols
  getPrices(symbols = null) {
    if (!symbols) {
      return Object.fromEntries(this.priceData);
    }
    
    const result = {};
    if (Array.isArray(symbols)) {
      symbols.forEach(symbol => {
        if (this.priceData.has(symbol)) {
          result[symbol] = this.priceData.get(symbol);
        }
      });
    } else if (this.priceData.has(symbols)) {
      result[symbols] = this.priceData.get(symbols);
    }
    
    return result;
  }

  close() {
    this.wss.close();
    this.pool.end();
  }
}

module.exports = TickerWebSocketServer;
