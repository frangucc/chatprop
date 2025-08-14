import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

// Common false positive words that get picked up as tickers
const FALSE_POSITIVE_WORDS = [
  'LOL', 'MORE', 'JUST', 'CAN', 'HOLD', 'UP', 'DOWN', 'ALL', 
  'ANY', 'ARE', 'ASK', 'BIG', 'BIT', 'BUY', 'DAY', 'DID', 
  'GET', 'GOT', 'HAS', 'HIT', 'HOT', 'HOW', 'ITS', 'LAST',
  'LIKE', 'LOOK', 'LOW', 'MAY', 'NEW', 'NOW', 'OFF', 'ONE',
  'OUT', 'OWN', 'PUT', 'RUN', 'SAW', 'SAY', 'SEE', 'SET',
  'TOP', 'TRY', 'TWO', 'USE', 'WAY', 'WHO', 'WHY', 'WIN',
  'WON', 'YES', 'YET', 'YOU', 'YOLO', 'MOON', 'HOLD'
];

interface StockInfo {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  marketCap: number;
  currency: string;
  exchange: string;
  country: string;
  logo: string;
  website: string;
  ipo: string;
  isValid: boolean;
}

async function fetchStockInfo(ticker: string): Promise<StockInfo | null> {
  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_API_KEY}`
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    // If no data or empty object, it's not a valid stock
    if (!data || Object.keys(data).length === 0) return null;
    
    return {
      ticker: ticker,
      name: data.name || '',
      sector: data.finnhubIndustry || '',
      industry: data.finnhubIndustry || '',
      marketCap: data.marketCapitalization || 0,
      currency: data.currency || 'USD',
      exchange: data.exchange || '',
      country: data.country || '',
      logo: data.logo || '',
      website: data.weburl || '',
      ipo: data.ipo || '',
      isValid: true
    };
  } catch (error) {
    console.error(`Error fetching stock info for ${ticker}:`, error);
    return null;
  }
}

async function analyzeStockContext(ticker: string, messages: string[]): Promise<{confidence: number, analysis: string}> {
  // If it's a known false positive, return low confidence immediately
  if (FALSE_POSITIVE_WORDS.includes(ticker.toUpperCase())) {
    return {
      confidence: 0.1,
      analysis: 'Common word that is rarely used as a stock ticker'
    };
  }
  
  // If we have no messages, can't analyze
  if (!messages || messages.length === 0) {
    return {
      confidence: 0.5,
      analysis: 'No messages to analyze'
    };
  }
  
  try {
    const sampleMessages = messages.slice(0, 10).join('\n');
    
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Analyze if these Discord messages are genuinely discussing the stock ticker $${ticker} or if "${ticker}" is being used as a regular word/acronym. 

Messages:
${sampleMessages}

Respond with JSON only:
{"confidence": 0.0-1.0, "analysis": "brief explanation"}`
      }]
    });
    
    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    const result = JSON.parse(content);
    
    return {
      confidence: result.confidence || 0.5,
      analysis: result.analysis || 'Unable to determine context'
    };
  } catch (error) {
    console.error(`Error analyzing context for ${ticker}:`, error);
    
    // Fallback heuristic: if it's in our false positive list, low confidence
    if (FALSE_POSITIVE_WORDS.includes(ticker.toUpperCase())) {
      return {
        confidence: 0.2,
        analysis: 'Common word, likely not a stock discussion'
      };
    }
    
    return {
      confidence: 0.5,
      analysis: 'Context analysis unavailable'
    };
  }
}

export async function POST(request: Request) {
  try {
    const { tickers } = await request.json();
    
    if (!tickers || !Array.isArray(tickers)) {
      return NextResponse.json({ error: 'Invalid tickers array' }, { status: 400 });
    }
    
    const validatedStocks = [];
    
    for (const tickerData of tickers) {
      const { ticker, messages } = tickerData;
      
      // Check if we already have this stock cached
      const cached = await pool.query(
        'SELECT * FROM stocks WHERE ticker = $1 AND last_validated > NOW() - INTERVAL \'24 hours\'',
        [ticker]
      );
      
      if (cached.rows.length > 0) {
        validatedStocks.push(cached.rows[0]);
        continue;
      }
      
      // Fetch stock info from Finnhub
      const stockInfo = await fetchStockInfo(ticker);
      
      // Analyze context with AI
      const contextAnalysis = await analyzeStockContext(ticker, messages);
      
      // Determine if this is a valid stock discussion
      const isValid = stockInfo !== null && contextAnalysis.confidence > 0.4;
      
      if (stockInfo && isValid) {
        // Save to database
        const result = await pool.query(
          `INSERT INTO stocks (
            ticker, name, sector, industry, market_cap, currency, 
            exchange, country, logo_url, website, ipo_date, is_valid, ai_confidence
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (ticker) DO UPDATE SET
            name = EXCLUDED.name,
            sector = EXCLUDED.sector,
            industry = EXCLUDED.industry,
            market_cap = EXCLUDED.market_cap,
            ai_confidence = EXCLUDED.ai_confidence,
            last_validated = NOW()
          RETURNING *`,
          [
            ticker,
            stockInfo.name,
            stockInfo.sector,
            stockInfo.industry,
            stockInfo.marketCap,
            stockInfo.currency,
            stockInfo.exchange,
            stockInfo.country,
            stockInfo.logo,
            stockInfo.website,
            stockInfo.ipo || null,
            isValid,
            contextAnalysis.confidence
          ]
        );
        
        validatedStocks.push(result.rows[0]);
      }
    }
    
    return NextResponse.json({ 
      validated: validatedStocks,
      total: tickers.length,
      valid: validatedStocks.length 
    });
    
  } catch (error) {
    console.error('Error validating stocks:', error);
    return NextResponse.json(
      { error: 'Failed to validate stocks' },
      { status: 500 }
    );
  }
}
