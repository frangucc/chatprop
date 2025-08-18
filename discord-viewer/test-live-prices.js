// Test the live server price endpoints

async function testLivePrices() {
  console.log('Testing Live Price Server...\n');
  
  // Test 1: Direct price query
  console.log('1. Testing /api/live/prices endpoint:');
  try {
    const pricesRes = await fetch('http://localhost:3000/api/live/prices?symbols=BMRA,XPON,SNGX');
    const prices = await pricesRes.json();
    console.log('Prices response:', JSON.stringify(prices, null, 2));
    
    if (Object.keys(prices).length === 0) {
      console.log('⚠️  No prices available yet (expected if no trades ingested)\n');
    }
  } catch (e) {
    console.error('❌ Error fetching prices:', e.message);
  }
  
  // Test 2: Ingest historical data for BMRA during active market hours
  console.log('\n2. Ingesting historical price for BMRA at 2025-08-16 10:30:00 AM CST:');
  try {
    const ingestRes = await fetch('http://localhost:3000/api/live/ingest_hist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols: ['BMRA'],
        timestamp: '2025-08-16T15:30:00Z' // 10:30 AM CST = 15:30 UTC
      })
    });
    
    if (!ingestRes.ok) {
      const text = await ingestRes.text();
      throw new Error(`HTTP ${ingestRes.status}: ${text}`);
    }
    
    const ingestData = await ingestRes.json();
    console.log('Ingest response:', JSON.stringify(ingestData, null, 2));
  } catch (e) {
    console.error('❌ Error ingesting historical data:', e.message);
  }
  
  // Test 3: Check prices again after ingest
  console.log('\n3. Checking prices after historical ingest:');
  try {
    const pricesRes2 = await fetch('http://localhost:3000/api/live/prices?symbols=BMRA');
    const prices2 = await pricesRes2.json();
    console.log('BMRA price:', JSON.stringify(prices2, null, 2));
    
    if (prices2.BMRA) {
      const lastPrice = prices2.BMRA.price || prices2.BMRA;
      console.log(`✅ BMRA last price: $${lastPrice}`);
    } else {
      console.log('❌ No BMRA price available');
    }
  } catch (e) {
    console.error('❌ Error fetching prices:', e.message);
  }
  
  // Test 4: Try ingesting for XPON and SNGX during market hours
  console.log('\n4. Ingesting prices for XPON and SNGX:');
  const otherTests = [
    { symbol: 'XPON', timestamp: '2025-08-16T16:00:00Z' }, // 11:00 AM CST Friday
    { symbol: 'SNGX', timestamp: '2025-08-16T18:00:00Z' }  // 1:00 PM CST Friday
  ];
  for (const { symbol, timestamp } of otherTests) {
    try {
      const res = await fetch('http://localhost:3000/api/live/ingest_hist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: [symbol],
          timestamp
        })
      });
      
      const data = await res.json();
      console.log(`${symbol}:`, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`❌ Error ingesting ${symbol}:`, e.message);
    }
  }
  
  // Final check
  console.log('\n5. Final price check for all symbols:');
  try {
    const finalRes = await fetch('http://localhost:3000/api/live/prices?symbols=BMRA,XPON,SNGX');
    const finalPrices = await finalRes.json();
    console.log('All prices:', JSON.stringify(finalPrices, null, 2));
    
    for (const [symbol, data] of Object.entries(finalPrices)) {
      const price = data.price || data;
      console.log(`${symbol}: $${price}`);
    }
  } catch (e) {
    console.error('❌ Error in final check:', e.message);
  }
}

testLivePrices().catch(console.error);
