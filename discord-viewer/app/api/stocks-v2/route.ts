import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trader = searchParams.get('trader');
  const minConfidence = parseFloat(searchParams.get('minConfidence') || '0.7');
  const dateRange = searchParams.get('dateRange') || 'today'; // today, week, month, all
  
  try {
    let query = `
      WITH ticker_data AS (
        SELECT 
          s.ticker,
          s.exchange,
          s.detection_confidence,
          s.ai_confidence,
          s.first_mention_timestamp,
          s.first_mention_author,
          s.first_mention_text,
          s.is_genuine_stock,
          -- Get actual mention count from ticker_mentions
          COALESCE(
            (SELECT COUNT(DISTINCT message_id) 
             FROM ticker_mentions tm 
             WHERE tm.ticker = s.ticker 
             AND tm.detected_at >= CURRENT_DATE), 
            s.mention_count
          ) as mention_count,
          -- Get unique authors
          COALESCE(
            (SELECT COUNT(DISTINCT author_name) 
             FROM ticker_mentions tm 
             WHERE tm.ticker = s.ticker 
             AND tm.detected_at >= CURRENT_DATE), 
            0
          ) as unique_authors,
          -- Check blacklist status
          EXISTS(SELECT 1 FROM ticker_blacklist bl WHERE bl.ticker = s.ticker) as is_blacklisted,
          -- Get blacklist reason if exists
          (SELECT reason FROM ticker_blacklist bl WHERE bl.ticker = s.ticker LIMIT 1) as blacklist_reason
        FROM stocks s
        WHERE s.is_genuine_stock = true 
        AND s.detection_confidence >= 0.70
      )
      SELECT * FROM ticker_data
      WHERE is_blacklisted = false
    `;
    
    const params: any[] = [];
    let paramCount = 0;

    // Handle trader filter
    if (traders) {
      const traderList = traders.split(',').map(t => t.trim()).filter(Boolean);
      if (traderList.length > 0) {
        // For trader filter, check mentions by those specific traders
        query = `
          WITH ticker_data AS (
            SELECT 
              s.ticker,
              s.exchange,
              s.detection_confidence,
              s.ai_confidence,
              s.first_mention_timestamp,
              s.first_mention_author,
              s.first_mention_text,
              s.is_genuine_stock,
              -- Count only mentions from specified traders
              (SELECT COUNT(DISTINCT tm.message_id) 
               FROM ticker_mentions tm
               JOIN discord_messages dm ON tm.message_id = dm.id
               WHERE tm.ticker = s.ticker 
               AND tm.detected_at >= CURRENT_DATE
               AND dm.author_name = ANY($1::text[])
              ) as mention_count,
              -- Count unique authors from specified traders
              (SELECT COUNT(DISTINCT tm.author_name) 
               FROM ticker_mentions tm
               WHERE tm.ticker = s.ticker 
               AND tm.detected_at >= CURRENT_DATE
               AND tm.author_name = ANY($1::text[])
              ) as unique_authors,
              -- Always check blacklist regardless of filter
              EXISTS(SELECT 1 FROM ticker_blacklist bl WHERE bl.ticker = s.ticker) as is_blacklisted
            FROM stocks s
            WHERE s.is_genuine_stock = true 
            AND s.detection_confidence >= 0.70
          )
          SELECT * FROM ticker_data
          WHERE mention_count > 0
          AND is_blacklisted = false
        `;
        params.push(traderList);
        paramCount++;
      }
    }

    // Handle search filter
    if (search) {
      if (params.length > 0) {
        query += ` AND ticker ILIKE $${++paramCount}`;
      } else {
        query += ` AND ticker ILIKE $1`;
        paramCount++;
      }
      params.push(`%${search}%`);
    }

    // Add ordering
    query += ` ORDER BY mention_count DESC, first_mention_timestamp DESC LIMIT 100`;

    const result = await pool.query(query, params);
    
    // Add additional context for each ticker
    const enrichedData = result.rows.map(row => ({
      ...row,
      displayMentions: row.mention_count,
      displayAuthors: row.unique_authors,
      confidenceLevel: 
        row.detection_confidence >= 0.90 ? 'high' :
        row.detection_confidence >= 0.75 ? 'medium' : 'low',
      isBlacklisted: row.is_blacklisted || false
    }));
    
    return NextResponse.json(enrichedData);
  } catch (error) {
    console.error('Error fetching stocks:', error);
    return NextResponse.json({ error: 'Failed to fetch stocks' }, { status: 500 });
  }
}
