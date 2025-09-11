import { NextRequest, NextResponse } from 'next/server';

interface DatabentoOHLCV {
  hd: {
    ts_event: string;
  };
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface HODResult {
  symbol: string;
  hod: number | null;
  error?: string;
}

async function fetchHODForSymbol(symbol: string, apiKey: string, date: string): Promise<HODResult> {
  try {
    // Start at midnight CST (6 AM UTC) to catch all pre-market trades
    const startDate = new Date(`${date}T06:00:00.000Z`); // Midnight CST (6 AM UTC)
    
    // Use current time with realistic delay based on Databento's data availability
    const now = new Date();
    const endDate = new Date(now.getTime() - 15 * 60 * 1000); // 15 minute delay
    
    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();
    
    // Dataset: EQUS.MINI for US Equities minute bars
    const dataset = process.env.DATABENTO_DATASET || 'EQUS.MINI';
    const schema = 'ohlcv-1m'; // 1-minute OHLCV bars
    
    // Build Databento API URL for historical minute bars
    const url = new URL('https://hist.databento.com/v0/timeseries.get_range');
    url.searchParams.set('dataset', dataset);
    url.searchParams.set('symbols', symbol.toUpperCase());
    url.searchParams.set('stype_in', 'raw_symbol');
    url.searchParams.set('start', startStr);
    url.searchParams.set('end', endStr);
    url.searchParams.set('schema', schema);
    url.searchParams.set('encoding', 'json');
    url.searchParams.set('limit', '1000'); // 1000 minute bars = ~16 hours
    
    // HTTP Basic auth with API key as username
    const authString = Buffer.from(`${apiKey}:`).toString('base64');
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      
      // If end time is after available data, try again with earlier end time
      if (response.status === 422 && errorText.includes('data_end_after_available_end')) {
        const earlierEnd = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes earlier
        const retryUrl = new URL(url.toString());
        retryUrl.searchParams.set('end', earlierEnd.toISOString());
        
        const retryResponse = await fetch(retryUrl.toString(), {
          headers: {
            'Authorization': `Basic ${authString}`,
            'Accept': 'application/json',
          },
        });
        
        if (retryResponse.ok) {
          const retryText = await retryResponse.text();
          return { symbol, hod: calculateHODFromText(retryText) };
        }
      }
      
      return { 
        symbol, 
        hod: null, 
        error: `Databento API error: ${response.status}` 
      };
    }
    
    const responseText = await response.text();
    const hod = calculateHODFromText(responseText);
    
    return { symbol, hod };
    
  } catch (error) {
    console.error(`HOD fetch error for ${symbol}:`, error);
    return { 
      symbol, 
      hod: null, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

function calculateHODFromText(responseText: string): number | null {
  const lines = responseText.trim().split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    return null;
  }
  
  let maxHigh = 0;
  
  for (const line of lines) {
    try {
      const bar: DatabentoOHLCV = JSON.parse(line);
      
      // Convert prices from nanoseconds to dollars
      const high = parseInt(bar.high) / 1_000_000_000;
      
      // Only include bars with valid price data
      if (high > 0 && high > maxHigh) {
        maxHigh = high;
      }
    } catch (parseError) {
      continue; // Skip invalid lines
    }
  }
  
  return maxHigh > 0 ? maxHigh : null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbolsParam = searchParams.get('symbols');
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    if (!symbolsParam) {
      return NextResponse.json(
        { error: 'symbols parameter is required' },
        { status: 400 }
      );
    }
    
    // Get API key from environment
    const apiKey = process.env.DATABENTO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'DATABENTO_API_KEY not configured' },
        { status: 500 }
      );
    }
    
    // Parse symbols (comma-separated)
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
    
    if (symbols.length === 0) {
      return NextResponse.json([]);
    }
    
    console.log(`Batch HOD request for ${symbols.length} symbols:`, symbols.slice(0, 5).join(', '), symbols.length > 5 ? '...' : '');
    
    // Fetch HOD for all symbols (with some concurrency limit to be nice to Databento)
    const CONCURRENCY_LIMIT = 3; // Process 3 symbols at a time
    const results: HODResult[] = [];
    
    for (let i = 0; i < symbols.length; i += CONCURRENCY_LIMIT) {
      const batch = symbols.slice(i, i + CONCURRENCY_LIMIT);
      const batchPromises = batch.map(symbol => fetchHODForSymbol(symbol, apiKey, date));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to be respectful to the API
      if (i + CONCURRENCY_LIMIT < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`HOD batch complete: ${results.filter(r => r.hod !== null).length}/${results.length} successful`);
    
    return NextResponse.json(results);
    
  } catch (error) {
    console.error('Batch HOD API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}