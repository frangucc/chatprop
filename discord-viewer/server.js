const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const RealTimeExtractorNotify = require('./real-time-extractor-notify');
const TickerWebSocketServer = require('./lib/websocket-server');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
const port = process.env.PORT || 3000;

const app = next({ dev });
const handle = app.getRequestHandler();

// Initialize real-time extractor
let realTimeExtractor = null;
let wsServer = null;

app.prepare().then(async () => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      
      // Handle WebSocket upgrade requests
      if (parsedUrl.pathname === '/ws') {
        // Let the WebSocket server handle this
        return;
      }
      
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize WebSocket server for tickers and price updates
  wsServer = new TickerWebSocketServer(server, process.env.DATABASE2_URL);

  // Initialize real-time extractor with NOTIFY
  realTimeExtractor = new RealTimeExtractorNotify();
  await realTimeExtractor.initialize();
  realTimeExtractor.setWebSocketServer(wsServer);

  // Graceful shutdown
  const gracefulShutdown = async () => {
    console.log('\n🛑 Shutting down server gracefully...');
    if (realTimeExtractor) {
      await realTimeExtractor.close();
    }
    if (wsServer) {
      wsServer.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log('> WebSocket server initialized for real-time ticker updates');
    console.log('> Real-time ticker extractor started');
  });
});
