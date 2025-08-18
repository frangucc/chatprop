import { NextResponse } from 'next/server';
import { Client } from 'pg';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const timestamp = searchParams.get('timestamp');
  
  if (!symbol || !timestamp) {
    return NextResponse.json(
      { error: 'Symbol and timestamp are required' },
      { status: 400 }
    );
  }

  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
  if (!FINNHUB_API_KEY) {
    return NextResponse.json(
      { error: 'Finnhub API key not configured' },
      { status: 500 }
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE2_URL,
  });

  try {
    await client.connect();
    
    // Check cache first
    const cacheResult = await client.query(
      'SELECT price FROM stock_price_cache WHERE symbol = $1 AND timestamp = $2',
      [symbol.toUpperCase(), timestamp]
    );
    
    if (cacheResult.rows.length > 0) {
      return NextResponse.json({
        price: cacheResult.rows[0].price,
        cached: true
      });
    }

    // Fetch current quote from Finnhub
    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch from Finnhub');
    }
    
    const data = await response.json();
    
    // Use the current price (c) for real-time
    // For historical context, we'd need to use candles API
    const price = data.c || 0;
    
    if (price > 0) {
      // Cache the price
      await client.query(
        `INSERT INTO stock_price_cache (symbol, timestamp, price, fetched_at) 
         VALUES ($1, $2, $3, NOW()) 
         ON CONFLICT (symbol, timestamp) DO UPDATE 
         SET price = $3, fetched_at = NOW()`,
        [symbol.toUpperCase(), timestamp, price]
      );
    }
    
    return NextResponse.json({
      price,
      cached: false,
      current: true
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
