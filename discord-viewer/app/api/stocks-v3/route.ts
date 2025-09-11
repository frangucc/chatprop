import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE2_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tradersParam = searchParams.get('traders');
  const traders = tradersParam ? tradersParam.split(',').map(t => t.trim()) : [];
  const search = searchParams.get('search');
  const minConfidence = parseFloat(searchParams.get('minConfidence') || '0.7');
  const dateRange = searchParams.get('dateRange') || 'today'; // today, week, month, all
  
  try {
    // Calculate date filter based on range
    let dateFilter = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    switch (dateRange) {
      case 'today':
        // Filter for today in Chicago time - messages from midnight CST today
        dateFilter = `AND m.discord_timestamp >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago'`;
        break;
      case 'week':
        dateFilter = `AND m.discord_timestamp >= NOW() - INTERVAL '7 days'`;
        break;
      case 'month':
        dateFilter = `AND m.discord_timestamp >= NOW() - INTERVAL '30 days'`;
        break;
      case 'all':
        dateFilter = ''; // No date filter
        break;
      default:
        // Default to today
        dateFilter = `AND m.discord_timestamp >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago'`;
    }
    
    // Build trader filter
    let traderFilter = '';
    if (traders.length > 0) {
      const traderPlaceholders = traders.map((_, idx) => `$${idx + 2}`).join(', ');
      traderFilter = `AND a.username IN (${traderPlaceholders})`;
    }
    
    let query = `
      WITH ticker_stats AS (
        SELECT 
          t.symbol,
          t.exchange,
          COUNT(DISTINCT td.message_id) as mention_count,
          COUNT(DISTINCT m.author_id) as unique_authors,
          AVG(td.confidence_score) as avg_confidence,
          MIN(m.discord_timestamp) as first_mention,
          MAX(m.discord_timestamp) as last_mention,
          -- Surge metrics: mentions in various time windows
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '5 minutes') as mentions_5min,
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '15 minutes') as mentions_15min,
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '30 minutes') as mentions_30min,
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '1 hour') as mentions_1hr,
          COUNT(DISTINCT td.message_id) FILTER (WHERE m.discord_timestamp >= NOW() - INTERVAL '4 hours') as mentions_4hr,
          -- Get sample high confidence mentions
          ARRAY_AGG(DISTINCT 
            CASE 
              WHEN td.confidence_score >= 0.8 
              THEN LEFT(m.content, 200)
              ELSE NULL 
            END
          ) FILTER (WHERE td.confidence_score >= 0.8) as sample_mentions,
          -- Check if mentioned by known traders
          BOOL_OR(a.is_trader) as mentioned_by_trader,
          -- Get first mention timestamp and author for Databento API price lookup
          (
            SELECT ROW(m2.discord_timestamp, a2.username)
            FROM ticker_detections td2
            JOIN messages m2 ON td2.message_id = m2.id
            JOIN authors a2 ON m2.author_id = a2.id
            WHERE td2.ticker_symbol = t.symbol
              AND td2.confidence_score >= $1
              ${dateFilter.replace('m.discord_timestamp', 'm2.discord_timestamp')}
              ${traderFilter.replace('a.username', 'a2.username')}
            ORDER BY m2.discord_timestamp ASC
            LIMIT 1
          ) as first_mention_details
        FROM tickers t
        JOIN ticker_detections td ON t.symbol = td.ticker_symbol
        JOIN messages m ON td.message_id = m.id
        JOIN authors a ON m.author_id = a.id
        WHERE td.confidence_score >= $1
        ${dateFilter}
        ${traderFilter}
        ${search ? `AND t.symbol ILIKE $${traders.length + 2}` : ''}
        GROUP BY t.symbol, t.exchange
      ),
      blacklist_check AS (
        SELECT 
          ts.*,
          bl.ticker IS NOT NULL as is_blacklisted,
          bl.reason as blacklist_reason,
          bl.min_confidence_required,
          CASE 
            WHEN bl.is_permanent THEN 'permanent'
            WHEN bl.requires_cashtag THEN 'requires_cashtag'
            WHEN bl.requires_price_context THEN 'requires_price'
            ELSE NULL
          END as blacklist_type
        FROM ticker_stats ts
        LEFT JOIN ticker_blacklist bl ON ts.symbol = bl.ticker
      )
      SELECT * FROM blacklist_check
      WHERE is_blacklisted = false 
        OR (is_blacklisted = true AND blacklist_type != 'permanent' AND avg_confidence >= COALESCE(min_confidence_required, 0.95))
      ORDER BY mention_count DESC, avg_confidence DESC
      LIMIT 100
    `;
    
    const params: any[] = [minConfidence];
    if (traders.length > 0) params.push(...traders.map(t => t.toLowerCase()));
    if (search) params.push(`%${search}%`);
    
    const result = await pool.query(query, params);
    
    // Format the response
    const stocks = result.rows.map(row => {
      // Extract first mention timestamp and author for Databento API lookup
      let firstMentionTimestamp = null;
      let firstMentionAuthor = null;
      
      if (row.first_mention_details) {
        // Parse the ROW(timestamp, username) format from PostgreSQL
        const detailsStr = row.first_mention_details;
        
        // More robust parsing for PostgreSQL ROW format
        const match = detailsStr.match(/^\("([^"]*(?:""[^"]*)*)","([^"]*(?:""[^"]*)*)"\)$/);
        if (match) {
          firstMentionTimestamp = match[1].replace(/""/g, '"'); // Unescape double quotes
          firstMentionAuthor = match[2].replace(/""/g, '"'); // Unescape double quotes
        } else {
          // Fallback for simpler format
          const simpleMatch = detailsStr.match(/^\(([^,]+),([^)]+)\)$/);
          if (simpleMatch) {
            firstMentionTimestamp = simpleMatch[1].replace(/^"(.*)"$/, '$1');
            firstMentionAuthor = simpleMatch[2].replace(/^"(.*)"$/, '$1');
          }
        }
      }
      
      // Calculate surge metrics
      const mentions5min = parseInt(row.mentions_5min) || 0;
      const mentions15min = parseInt(row.mentions_15min) || 0;
      const mentions30min = parseInt(row.mentions_30min) || 0;
      const mentions1hr = parseInt(row.mentions_1hr) || 0;
      const mentions4hr = parseInt(row.mentions_4hr) || 0;
      
      // Calculate surge rates (mentions per minute for each window)
      const surgeRates = {
        '5min': mentions5min / 5,
        '15min': mentions15min / 15,
        '30min': mentions30min / 30,
        '1hr': mentions1hr / 60
      };
      
      // Find the best surge rate and its time window
      const bestSurgeEntry = Object.entries(surgeRates).reduce((best, [window, rate]) => 
        rate > best[1] ? [window, rate] : best
      );
      
      const [bestWindow, bestSurgeRate] = bestSurgeEntry;
      
      // Calculate time since last mention in hours
      const hoursSinceLastMention = row.last_mention ? 
        (Date.now() - new Date(row.last_mention).getTime()) / (1000 * 60 * 60) : Infinity;

      return {
        ticker: row.symbol,
        exchange: row.exchange || 'UNKNOWN',
        mentionCount: parseInt(row.mention_count),
        uniqueAuthors: parseInt(row.unique_authors),
        avgConfidence: parseFloat(row.avg_confidence),
        firstMention: row.first_mention,
        lastMention: row.last_mention,
        // Surge metrics
        surge: {
          mentions5min,
          mentions15min, 
          mentions30min,
          mentions1hr,
          mentions4hr,
          bestRate: bestSurgeRate,
          bestWindow: bestWindow,
          hoursSinceLastMention
        },
        sampleMentions: row.sample_mentions?.filter(Boolean).slice(0, 3),
        mentionedByTrader: row.mentioned_by_trader,
        isBlacklisted: row.is_blacklisted,
        blacklistReason: row.blacklist_reason,
        firstMentionPrice: null, // Will be populated by Databento API
        firstMentionAuthor: firstMentionAuthor,
        firstMentionTimestamp: firstMentionTimestamp, // For Databento API lookup
        // Calculate momentum (mentions in last hour vs previous)
        momentum: calculateMomentum(row)
      };
    });
    
    // Fetch first mention prices from Databento API (with concurrency control and timeout)
    // Only fetch prices for top 20 stocks to avoid timeout
    const stocksToProcess = stocks.slice(0, 20);
    const remainingStocks = stocks.slice(20);
    
    const pricePromises = stocksToProcess.map(async (stock) => {
      if (stock.firstMentionTimestamp) {
        try {
          // Convert PostgreSQL timestamp to ISO format for Databento API
          // From: "2025-09-11 12:16:59.917 00" -> To: "2025-09-11T12:16:59.917Z"
          let isoTimestamp = stock.firstMentionTimestamp;
          if (isoTimestamp.includes(' ')) {
            // Replace space with T and handle timezone
            isoTimestamp = isoTimestamp.replace(' ', 'T');
            if (isoTimestamp.endsWith(' 00')) {
              isoTimestamp = isoTimestamp.replace(' 00', 'Z');
            } else if (isoTimestamp.endsWith('+00')) {
              isoTimestamp = isoTimestamp.replace('+00', 'Z');
            }
          }
          
          // Add timeout to individual requests
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout
          
          const response = await fetch(`http://localhost:3000/api/databento?symbol=${stock.ticker}&timestamp=${isoTimestamp}`, {
            signal: controller.signal
          });
          clearTimeout(timeout);
          
          if (response.ok) {
            const data = await response.json();
            stock.firstMentionPrice = data.price;
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            console.log(`Timeout fetching price for ${stock.ticker}`);
          } else {
            console.error(`Failed to fetch price for ${stock.ticker}:`, error);
          }
          // Keep firstMentionPrice as null if API call fails
        }
      }
      return stock;
    });
    
    // Wait for all price lookups to complete (with overall timeout)
    const stocksWithPrices = await Promise.all(pricePromises);
    
    // Combine processed stocks with remaining stocks (which keep firstMentionPrice as null)
    const allStocks = [...stocksWithPrices, ...remainingStocks];
    
    return NextResponse.json({
      stocks: allStocks,
      meta: {
        dateRange,
        minConfidence,
        traders: traders.length > 0 ? traders : undefined,
        search,
        totalCount: allStocks.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error fetching stocks:', error);
    // Return the actual error message for debugging
    return NextResponse.json({ 
      error: 'Failed to fetch stocks', 
      details: error instanceof Error ? error.message : 'Unknown error',
      query: dateRange // Show which date range was attempted
    }, { status: 500 });
  }
}

function calculateMomentum(row: any): string {
  // Simple momentum indicator based on recent mentions
  const recentMentions = row.mention_count || 0;
  if (recentMentions > 10) return '🔥 Hot';
  if (recentMentions > 5) return '📈 Rising';
  if (recentMentions > 2) return '👀 Emerging';
  return '🆕 New';
}
