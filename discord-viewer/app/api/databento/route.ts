import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { Client } from 'pg';

const DATABENTO_API_KEY = process.env.DATABENTO_API_KEY || 'db-tLudQVLbGRAXxscuBBiu8iHgv8cmk';

export async function GET(request: NextRequest) {
  const client = new Client({
    connectionString: process.env.DATABASE2_URL
  });
  
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const timestamp = searchParams.get('timestamp');
    
    if (!symbol || !timestamp) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    await client.connect();
    
    // Check if we already have this price in the database
    const cacheResult = await client.query(
      'SELECT * FROM stock_price_cache WHERE symbol = $1 AND timestamp = $2',
      [symbol.toUpperCase(), timestamp]
    );
    
    if (cacheResult.rows.length > 0) {
      const cached = cacheResult.rows[0];
      return NextResponse.json({
        price: parseFloat(cached.price),
        timestamp: cached.timestamp,
        symbol: cached.symbol,
        cached: true
      });
    }

    const apiKey = process.env.DATABENTO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Databento API key not configured' },
        { status: 500 }
      );
    }

    let startDate = new Date(timestamp);
    const cstHour = (startDate.getUTCHours() - 6 + 24) % 24; // Convert to CST
    const cstMinutes = startDate.getMinutes();
    const totalMinutes = cstHour * 60 + cstMinutes;
    
    // Regular market hours: 8:30 AM to 3:00 PM CST (9:30 AM - 4:00 PM EST)
    // Pre-market: 3:00 AM - 8:30 AM CST
    // After-hours: 3:00 PM - 7:00 PM CST
    const isRegularMarket = totalMinutes >= 510 && totalMinutes <= 900; // 8:30 AM - 3:00 PM CST
    const isPreMarket = totalMinutes >= 180 && totalMinutes < 510; // 3:00 AM - 8:30 AM CST
    const isAfterHours = totalMinutes > 900 && totalMinutes <= 1140; // 3:00 PM - 7:00 PM CST
    const isMarketHours = isRegularMarket || isPreMarket || isAfterHours;
    
    let endDate;
    let searchingForClose = false;
    
    if (isMarketHours) {
      // During market hours: fetch 2-second window around the timestamp
      startDate.setTime(startDate.getTime() - 1000); // 1 second before
      endDate = new Date(startDate.getTime() + 2000); // 2 seconds total window
    } else {
      // Outside market hours, get the close price for that day
      searchingForClose = true;
      const closeTime = new Date(startDate);
      closeTime.setUTCHours(0, 0, 0, 0); // Start of day UTC
      closeTime.setUTCHours(closeTime.getUTCHours() + 19); // 7 PM CST = 1 AM next day UTC
      
      if (startDate < closeTime) {
        // Before market close, get the previous day's close
        closeTime.setDate(closeTime.getDate() - 1);
      }
      
      // Search window: 30 minutes before close to close time
      startDate.setTime(closeTime.getTime() - 1800000); // 30 minutes before close
      endDate = closeTime;
    }

    const start = startDate.toISOString();
    const end = endDate.toISOString();

    // Fetch trades data from Databento
    const url = `https://hist.databento.com/v0/timeseries.get_range?dataset=XNAS.BASIC&symbols=${symbol}&stype_in=raw_symbol&start=${start}&end=${end}&schema=trades&encoding=json&limit=100`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(DATABENTO_API_KEY + ':').toString('base64')
      }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Databento API error:', error);
      console.error('Request URL:', url);
      console.error('Start:', start, 'End:', end);
      return NextResponse.json(
        { error: 'Failed to fetch price data', details: error },
        { status: response.status }
      );
    }

    const data = await response.text();
    const lines = data.trim().split('\n').filter(line => line);
    
    // Parse trades and calculate average price
    let totalPrice = 0;
    let totalVolume = 0;
    let tradeCount = 0;
    let minPrice = Infinity;
    let maxPrice = -Infinity;

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
        }
      } catch (e) {
        // Skip invalid lines
      }
    }

    if (tradeCount === 0 && !searchingForClose) {
      // Try to get the last available price before this timestamp
      const fallbackUrl = `https://hist.databento.com/v0/timeseries.get_range?dataset=XNAS.BASIC&symbols=${symbol}&stype_in=raw_symbol&end=${start}&schema=trades&encoding=json&limit=1`;
      
      try {
        const fallbackResponse = await fetch(fallbackUrl, {
          headers: {
            'Authorization': 'Basic ' + Buffer.from(DATABENTO_API_KEY + ':').toString('base64')
          }
        });
        
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.text();
          const fallbackLines = fallbackData.trim().split('\n').filter(line => line);
          
          if (fallbackLines.length > 0) {
            const lastTrade = JSON.parse(fallbackLines[fallbackLines.length - 1]);
            if (lastTrade.price) {
              const price = lastTrade.price / 1000000000;
              // No trades found - track failure
              await client.query(
                `INSERT INTO ticker_lookup_failures (ticker_symbol, failure_count, last_failure_date)
                 VALUES ($1, 1, CURRENT_TIMESTAMP)
                 ON CONFLICT (ticker_symbol) DO UPDATE 
                 SET failure_count = ticker_lookup_failures.failure_count + 1,
                     last_failure_date = CURRENT_TIMESTAMP`,
                [symbol.toUpperCase()]
              );
              
              if (isMarketHours) {
                return NextResponse.json({
                  error: 'No trades found in the specified time window',
                  timestamp,
                  symbol
                }, { status: 404 });
              } else {
                return NextResponse.json({
                  error: 'No closing price found for this day',
                  timestamp,
                  symbol
                }, { status: 404 });
              }
            }
          }
        }
      } catch (e) {
        console.error('Fallback price fetch failed:', e);
      }
      
      // Store the price in the database
      await client.query(
        `INSERT INTO stock_price_cache 
         (symbol, timestamp, price, min_price, max_price, trade_count, total_volume, is_market_hours) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (symbol, timestamp) DO NOTHING`,
        [symbol.toUpperCase(), timestamp, 0, 0, 0, 0, 0, isMarketHours]
      );
      
      return NextResponse.json({
        price: 0,
        timestamp,
        symbol,
        tradeCount: 0,
        totalVolume: 0,
        message: isMarketHours 
          ? 'No trades found in 2-second window'
          : 'Market closed - no price available'
      });
    }

    const avgPrice = totalVolume > 0 ? totalPrice / totalVolume : 0;
    
    // Calculate simple average as fallback if no volume data
    const simpleAvg = tradeCount > 0 ? (minPrice + maxPrice) / 2 : 0;
    const finalPrice = avgPrice > 0 ? avgPrice : simpleAvg;

    // Store the price in the database
    await client.query(
      `INSERT INTO stock_price_cache 
       (symbol, timestamp, price, price_min, price_max, trade_count, is_market_hours) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (symbol, timestamp) DO NOTHING`,
      [symbol.toUpperCase(), timestamp, finalPrice, minPrice, maxPrice, tradeCount, isMarketHours]
    );
    
    return NextResponse.json({
      price: finalPrice,
      timestamp,
      symbol,
      tradeCount,
      totalVolume,
      message: isMarketHours 
        ? `Found ${tradeCount} trades in 2-second window`
        : `Market closed - showing price from ${endDate.getUTCHours()}:${endDate.getUTCMinutes().toString().padStart(2, '0')} CST`
    });
  } catch (error) {
    console.error('Error fetching price data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch price data' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
