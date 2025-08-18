// Simple test script to get live data from Databento
// Using their REST API to simulate what the Rust client does

const DATABENTO_API_KEY = 'db-tLudQVLbGRAXxscuBBiu8iHgv8cmk';

async function testLiveData() {
  console.log('Testing Databento Live Data...\n');
  
  // Test current market time (Sunday 11:43 AM CST = 17:43 UTC)
  // Markets are closed, but let's test with recent Friday data
  
  const symbols = ['BMRA', 'XPON', 'SNGX'];
  
  for (const symbol of symbols) {
    console.log(`\nTesting ${symbol}:`);
    
    // Try to get recent trades from Friday (Aug 16, 2025)
    // Using a broader window during market hours
    const marketDate = '2025-08-16';
    const marketOpenUTC = `${marketDate}T13:30:00Z`; // 8:30 AM CST
    const marketCloseUTC = `${marketDate}T20:00:00Z`; // 3:00 PM CST
    
    const url = `https://hist.databento.com/v0/timeseries.get_range?` +
      `dataset=EQUS&` +
      `symbols=${symbol}&` +
      `stype_in=raw_symbol&` +
      `start=${marketOpenUTC}&` +
      `end=${marketCloseUTC}&` +
      `schema=trades&` +
      `encoding=json&` +
      `limit=10`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(DATABENTO_API_KEY + ':').toString('base64')
        }
      });
      
      if (!response.ok) {
        const text = await response.text();
        console.log(`  Error ${response.status}: ${text}`);
        continue;
      }
      
      const data = await response.text();
      const lines = data.trim().split('\n').filter(line => line);
      
      console.log(`  Found ${lines.length} trades`);
      
      if (lines.length > 0) {
        // Show first and last trade
        const firstTrade = JSON.parse(lines[0]);
        const lastTrade = JSON.parse(lines[lines.length - 1]);
        
        const firstPrice = firstTrade.price / 1000000000;
        const lastPrice = lastTrade.price / 1000000000;
        
        const firstTime = new Date(firstTrade.ts_event / 1000000).toISOString();
        const lastTime = new Date(lastTrade.ts_event / 1000000).toISOString();
        
        console.log(`  First trade: $${firstPrice.toFixed(2)} at ${firstTime}`);
        console.log(`  Last trade: $${lastPrice.toFixed(2)} at ${lastTime}`);
        console.log(`  Price change: $${(lastPrice - firstPrice).toFixed(2)} (${((lastPrice/firstPrice - 1) * 100).toFixed(2)}%)`);
      }
      
    } catch (error) {
      console.error(`  Error: ${error.message}`);
    }
  }
  
  console.log('\n\nNote: This uses historical data since markets are closed on Sunday.');
  console.log('The Rust live server (port 7878) connects to EQUS.MINI for real-time trades during market hours.');
}

testLiveData();
