import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const pool = new Pool({
  connectionString: process.env.DATABASE2_URL || process.env.DATABASE_URL,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface MessageData {
  id: string;
  content: string;
  timestamp: string;
  author_name: string;
  price?: number;
  formattedPrice?: string;
}

interface SquawkData {
  ticker: string;
  messages: MessageData[];
  currentPrice?: number;
  firstMentionPrice?: string;
  firstMentionAuthor?: string;
  dateRange: string;
  filteredTraders?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, traders, range = 'all' } = body;
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker parameter is required' }, { status: 400 });
    }

    // Fetch all messages for this ticker with the same logic as the ticker page
    let query = `
      SELECT DISTINCT
        m.id,
        m.content,
        m.discord_timestamp as timestamp,
        a.username as author_name,
        td.confidence_score
      FROM ticker_detections td
      JOIN messages m ON td.message_id = m.id
      JOIN authors a ON m.author_id = a.id
      WHERE UPPER(td.ticker_symbol) = UPPER($1)
        AND td.confidence_score >= 0.7
    `;
    
    const queryParams: any[] = [ticker];
    let paramIndex = 2;
    
    // Filter by traders if specified
    if (traders && traders.length > 0) {
      const placeholders = traders.map((_: any, i: number) => `$${paramIndex + i}`).join(',');
      query += ` AND a.username IN (${placeholders})`;
      queryParams.push(...traders);
      paramIndex += traders.length;
    }
    
    // Filter by date range if specified
    if (range && range !== 'all') {
      const now = new Date();
      
      if (range === 'today') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        query += ` AND m.discord_timestamp >= $${paramIndex}`;
        queryParams.push(today.toISOString());
      } else if (range === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        query += ` AND m.discord_timestamp >= $${paramIndex}`;
        queryParams.push(weekAgo.toISOString());
      } else if (range === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        query += ` AND m.discord_timestamp >= $${paramIndex}`;
        queryParams.push(monthAgo.toISOString());
      }
    }
    
    // Order by timestamp to get chronological flow
    query += ` ORDER BY m.discord_timestamp ASC LIMIT 200`;
    
    const result = await pool.query(query, queryParams);
    const messages = result.rows;
    
    if (messages.length === 0) {
      return NextResponse.json({ 
        report: `No messages found for $${ticker.toUpperCase()} in the specified time period.` 
      });
    }

    // Get additional context for pricing
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    
    // Fetch current price if available
    let currentPrice = null;
    try {
      const priceResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/live/prices?symbols=${ticker.toUpperCase()}`);
      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        const tickerPrice = priceData.find((p: any) => p.symbol.toUpperCase() === ticker.toUpperCase());
        if (tickerPrice) {
          currentPrice = tickerPrice.price;
        }
      }
    } catch (error) {
      console.log('Could not fetch current price:', error);
    }

    // Build comprehensive data for AI analysis
    const squawkData: SquawkData = {
      ticker: ticker.toUpperCase(),
      messages: messages.map((msg: any) => ({
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
        author_name: msg.author_name,
      })),
      currentPrice,
      dateRange: range,
      filteredTraders: traders
    };

    // Create the AI prompt
    const prompt = `You are creating "The Has Juice Squawk Report" - a concise trading report for ticker $${squawkData.ticker}.

CRITICAL FORMAT REQUIREMENTS:
1. ALWAYS start with: "The Has Juice Squawk Report: [TICKER], [Company description in 1 sentence], Last Price: $X.XX, first mentioned by Trader @[username] at $X.XX, saw high points of $X.XX, a X% gain from first mention."

2. For audio compatibility: ALWAYS write "Trader" before @ signs (e.g., "Trader @john31600" not just "@john31600")

3. Focus on ACCURACY and TIMING of calls:
   - Who called it FIRST and what happened next
   - Traders who explicitly said they were buying/selling and were RIGHT
   - Traders who warned of pullbacks/dips and were CORRECT
   - Calculate percentage gains from key entry points

ANALYSIS PRIORITIES:
1. FIRST MENTION: Identify the earliest trader who mentioned this ticker and at what implied price
2. HIGH WATER MARK: What was the highest price mentioned or implied throughout the session
3. ACCURATE CALLS: Which traders made explicit buy/sell calls that proved correct
4. TIMING: When did key moves happen relative to trader calls
5. SENTIMENT SHIFTS: How trader sentiment evolved with price action

DATA PROVIDED:
- Ticker: $${squawkData.ticker}
- Current Price: ${squawkData.currentPrice ? `$${squawkData.currentPrice.toFixed(2)}` : 'Not available'}
- Time Period: ${squawkData.dateRange === 'today' ? 'Today' : squawkData.dateRange === 'week' ? 'This Week' : squawkData.dateRange === 'month' ? 'This Month' : 'All Time'}
- Messages: ${squawkData.messages.length}

MESSAGES (chronological order):
${squawkData.messages.map((msg, i) => {
  const timestamp = new Date(msg.timestamp).toLocaleString();
  return `[${i + 1}] ${timestamp} - @${msg.author_name}: ${msg.content}`;
}).join('\n')}

REQUIRED OUTPUT FORMAT:
"The Has Juice Squawk Report: $[TICKER], [1-sentence company description], Last Price: $X.XX, first mentioned by Trader @[username] at $X.XX, saw high points of $X.XX, a X% gain from first mention.

[2-3 paragraphs focusing on accurate calls, timing, and trader performance]

Key Takeaways:
• [3-5 bullet points emphasizing accurate calls and timing]"

Remember: This will be read aloud, so write "Trader @username" every time, calculate percentage gains accurately, and emphasize who got it right and when.

THE HAS JUICE SQUAWK REPORT:`;

    // Generate report using Claude
    const completion = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const report = completion.content[0].type === 'text' ? completion.content[0].text : 'Error generating report';

    return NextResponse.json({
      report,
      metadata: {
        ticker: squawkData.ticker,
        messageCount: squawkData.messages.length,
        dateRange: squawkData.dateRange,
        filteredTraders: squawkData.filteredTraders,
        currentPrice: squawkData.currentPrice,
        timeGenerated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error generating squawk report:', error);
    return NextResponse.json(
      { 
        error: 'Failed to generate squawk report',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}