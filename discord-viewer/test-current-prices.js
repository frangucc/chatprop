// Test current live prices from Databento

async function getCurrentPrices() {
  console.log('📈 Current Live Stock Prices (Monday, Aug 18, 2025 @ 12:27 PM CST)\n');
  
  const symbols = ['XPON', 'BMRA', 'SNGX'];
  
  // Test individual symbols
  for (const symbol of symbols) {
    try {
      const res = await fetch(`http://localhost:7878/api/live/prices?symbols=${symbol}`);
      const text = await res.text();
      console.log(`Raw response for ${symbol}:`, text);
      
      if (text) {
        const data = JSON.parse(text);
        if (data[symbol]) {
          const price = data[symbol].price;
          const timestamp = data[symbol].ts_event_ns;
          const time = timestamp ? new Date(timestamp / 1000000).toLocaleTimeString() : 'N/A';
          console.log(`${symbol}: $${price.toFixed(4)} (last trade: ${time})`);
        } else {
          console.log(`${symbol}: No trades yet`);
        }
      } else {
        console.log(`${symbol}: Empty response`);
      }
    } catch (e) {
      console.log(`${symbol}: Error - ${e.message}`);
    }
  }
  
  // Get all prices
  console.log('\n📊 All Available Prices:');
  try {
    const res = await fetch('http://localhost:7878/api/live/all');
    const text = await res.text();
    console.log('Raw all prices response:', text ? `${text.substring(0, 100)}...` : 'empty');
    
    if (text) {
      const allPrices = JSON.parse(text);
      for (const [key, value] of Object.entries(allPrices)) {
        if (!key.startsWith('INST:') && value.price) {
          console.log(`  ${key}: $${value.price.toFixed(4)}`);
        }
      }
    }
  } catch (e) {
    console.error('Error fetching all prices:', e.message);
  }
}

getCurrentPrices();
