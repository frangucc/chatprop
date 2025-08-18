const http = require('http');

// Simple HTTP GET request
function getLivePrices(symbol) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:7878/api/live/prices?symbols=${symbol}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('📈 LIVE Stock Prices from Databento\n');
  console.log('Time:', new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), 'CST\n');
  
  const symbols = ['XPON', 'BMRA', 'SNGX'];
  
  for (const symbol of symbols) {
    try {
      const data = await getLivePrices(symbol);
      if (data[symbol] && data[symbol].price) {
        console.log(`${symbol}: $${data[symbol].price.toFixed(4)}`);
      } else {
        console.log(`${symbol}: No trades yet`);
      }
    } catch (e) {
      console.log(`${symbol}: Error - ${e.message}`);
    }
  }
}

main().catch(console.error);
