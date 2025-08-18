const DATABENTO_API_KEY = 'db-tLudQVLbGRAXxscuBBiu8iHgv8cmk';

async function testDatabento() {
  // Test for BMRA at 9:04:48 AM CST on 2025-08-14
  // 9:04:48 AM CST = 14:04:48 UTC (during DST, CST is UTC-5)
  const timestamp = '2025-08-14T14:04:48Z';
  const symbol = 'BMRA';
  
  // 2-second window: 1 second before, 1 second after
  const startDate = new Date(timestamp);
  startDate.setTime(startDate.getTime() - 1000);
  const endDate = new Date(startDate.getTime() + 2000);
  
  const start = startDate.toISOString();
  const end = endDate.toISOString();
  
  console.log(`Testing BMRA at 7:35:58 AM CST (${timestamp})`);
  console.log(`Window: ${start} to ${end}`);
  
  const url = `https://hist.databento.com/v0/timeseries.get_range?dataset=EQUS&symbols=${symbol}&stype_in=raw_symbol&start=${start}&end=${end}&schema=trades&encoding=json&limit=100`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(DATABENTO_API_KEY + ':').toString('base64')
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.text();
    const lines = data.trim().split('\n').filter(line => line);
    
    let totalPrice = 0;
    let totalVolume = 0;
    let tradeCount = 0;
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    
    console.log(`\nFound ${lines.length} trades:`);
    
    for (const line of lines) {
      try {
        const trade = JSON.parse(line);
        if (trade.price && trade.size) {
          const price = trade.price / 1000000000; // Convert from 1e-9 to dollars
          const volume = trade.size;
          
          totalPrice += price * volume;
          totalVolume += volume;
          tradeCount++;
          
          minPrice = Math.min(minPrice, price);
          maxPrice = Math.max(maxPrice, price);
          
          console.log(`  Trade: $${price.toFixed(2)} x ${volume} shares`);
        }
      } catch (e) {
        // Skip invalid lines
      }
    }
    
    const avgPrice = totalVolume > 0 ? totalPrice / totalVolume : 0;
    
    console.log(`\nSummary:`);
    console.log(`  Trades found: ${tradeCount}`);
    console.log(`  Price range: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`);
    console.log(`  Volume-weighted avg: $${avgPrice.toFixed(2)}`);
    console.log(`  Total volume: ${totalVolume} shares`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testDatabento();
