import { NextRequest, NextResponse } from 'next/server';

function parseOHLCVData(lines: string[], symbol: string): HistoricalDataPoint[] {
  const historicalData: HistoricalDataPoint[] = [];
  
  for (const line of lines) {
    try {
      const bar: DatabentoOHLCV = JSON.parse(line);
      
      // Convert nanosecond timestamp to ISO string
      const timestamp = new Date(parseInt(bar.hd.ts_event) / 1_000_000);
      
      // Convert prices from nanoseconds to dollars
      const open = parseInt(bar.open) / 1_000_000_000;
      const high = parseInt(bar.high) / 1_000_000_000;
      const low = parseInt(bar.low) / 1_000_000_000;
      const close = parseInt(bar.close) / 1_000_000_000;
      
      // Only include bars with valid price data
      if (close > 0 && open > 0) {
        historicalData.push({
          time: timestamp.toISOString(),
          open: open,
          high: high,
          low: low,
          close: close,
          volume: parseInt(bar.volume)
        });
      }
    } catch (parseError) {
      console.warn('Failed to parse OHLCV line:', line, parseError);
      continue;
    }
  }
  
  // Sort by timestamp to ensure proper order
  historicalData.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  
  console.log(`Returning ${historicalData.length} data points for ${symbol}`);
  return historicalData;
}

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

interface HistoricalDataPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const interval = searchParams.get('interval') || '1m';
    
    console.log(`Chart API request: symbol=${symbol}, date=${date}, interval=${interval}`);
    
    // Get API key from environment
    const apiKey = process.env.DATABENTO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'DATABENTO_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Start at midnight CST (6 AM UTC) to catch all pre-market trades
    const startDate = new Date(`${date}T06:00:00.000Z`); // Midnight CST (6 AM UTC)
    
    // Use current time with realistic delay based on Databento's data availability
    const now = new Date();
    const endDate = new Date(now.getTime() - 15 * 60 * 1000); // 15 minute delay (Databento's actual delay)
    
    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();
    
    // Dataset: EQUS.MINI for US Equities minute bars (per Databento support)
    const dataset = process.env.DATABENTO_DATASET || 'EQUS.MINI';
    const schema = 'ohlcv-1m'; // 1-minute OHLCV bars (per Databento support)
    
    // Build Databento API URL for historical minute bars
    const url = new URL('https://hist.databento.com/v0/timeseries.get_range');
    url.searchParams.set('dataset', dataset);
    url.searchParams.set('symbols', symbol.toUpperCase());
    url.searchParams.set('stype_in', 'raw_symbol');
    url.searchParams.set('start', startStr);
    url.searchParams.set('end', endStr);
    url.searchParams.set('schema', schema);
    url.searchParams.set('encoding', 'json');
    url.searchParams.set('limit', '1000'); // 1000 minute bars = ~16 hours (more than enough for a trading day)
    
    console.log(`Fetching chart data: ${url.toString()}`);
    
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
      console.error(`Databento API error (${response.status}):`, errorText);
      console.error(`Request URL was: ${url.toString()}`);
      
      // If end time is after available data, try again with earlier end time
      if (response.status === 422 && errorText.includes('data_end_after_available_end')) {
        console.log('End time too late, retrying with earlier end...');
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
          const retryLines = retryText.trim().split('\n').filter(line => line.trim());
          console.log(`Retry successful: got ${retryLines.length} bars`);
          // Continue with retry data
          const responseText = retryText;
          const lines = retryLines;
          
          // Jump to parsing logic - just inline it for now
          return NextResponse.json(parseOHLCVData(retryLines, symbol));
        }
      }
      
      return NextResponse.json(
        { 
          error: `Failed to fetch data from Databento: ${response.statusText}`,
          details: errorText,
          requestUrl: url.toString()
        },
        { status: response.status }
      );
    }
    
    const responseText = await response.text();
    const lines = responseText.trim().split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      return NextResponse.json([]);
    }
    
    const historicalData = parseOHLCVData(lines, symbol);
    return NextResponse.json(historicalData);
    
  } catch (error) {
    console.error('Chart API error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}