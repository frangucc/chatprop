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
        // For timezone-aware columns, filter for today in CST
        dateFilter = `AND m.discord_timestamp AT TIME ZONE 'America/Chicago' >= (CURRENT_DATE::date)::timestamp`;
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
        dateFilter = `AND m.discord_timestamp AT TIME ZONE 'America/Chicago' >= (CURRENT_DATE::date)::timestamp`;
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
          -- Get sample high confidence mentions
          ARRAY_AGG(DISTINCT 
            CASE 
              WHEN td.confidence_score >= 0.8 
              THEN LEFT(m.content, 200)
              ELSE NULL 
            END
          ) FILTER (WHERE td.confidence_score >= 0.8) as sample_mentions,
          -- Check if mentioned by known traders
          BOOL_OR(a.is_trader) as mentioned_by_trader
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
        OR (is_blacklisted = true AND avg_confidence >= COALESCE(min_confidence_required, 0.95))
      ORDER BY mention_count DESC, avg_confidence DESC
      LIMIT 100
    `;
    
    const params: any[] = [minConfidence];
    if (traders.length > 0) params.push(...traders.map(t => t.toLowerCase()));
    if (search) params.push(`%${search}%`);
    
    const result = await pool.query(query, params);
    
    // Format the response
    const stocks = result.rows.map(row => ({
      ticker: row.symbol,
      exchange: row.exchange || 'UNKNOWN',
      mentionCount: parseInt(row.mention_count),
      uniqueAuthors: parseInt(row.unique_authors),
      avgConfidence: parseFloat(row.avg_confidence),
      firstMention: row.first_mention,
      lastMention: row.last_mention,
      sampleMentions: row.sample_mentions?.filter(Boolean).slice(0, 3),
      mentionedByTrader: row.mentioned_by_trader,
      isBlacklisted: row.is_blacklisted,
      blacklistReason: row.blacklist_reason,
      // Calculate momentum (mentions in last hour vs previous)
      momentum: calculateMomentum(row)
    }));
    
    return NextResponse.json({
      stocks,
      meta: {
        dateRange,
        minConfidence,
        traders: traders.length > 0 ? traders : undefined,
        search,
        totalCount: stocks.length,
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
