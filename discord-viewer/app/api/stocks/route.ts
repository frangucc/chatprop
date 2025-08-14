import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tradersParam = searchParams.get('traders');
    const traders = tradersParam ? tradersParam.split(',') : [];

    let query = `
      SELECT 
        s.ticker,
        s.exchange,
        s.mention_count,
        s.detection_confidence,
        s.ai_confidence,
        s.first_mention_timestamp,
        s.first_mention_author,
        s.is_genuine_stock
      FROM stocks s
      WHERE s.is_genuine_stock = true 
      AND s.detection_confidence >= 0.70
      AND s.ticker NOT IN (SELECT ticker FROM ticker_blacklist)
    `;

    let queryParams: any[] = [];

    // If traders are specified, filter by those traders and calculate today's mention counts
    if (traders.length > 0) {
      query = `
        WITH today_trader_mentions AS (
          SELECT 
            s.ticker,
            COUNT(DISTINCT dm.id) as mention_count
          FROM stocks s
          INNER JOIN discord_messages dm ON (
            dm.author_name = ANY($1)
            AND DATE(dm.timestamp) = CURRENT_DATE
            AND (
              dm.content ILIKE '%$' || s.ticker || '%' OR
              dm.content ~* ('(^|[^A-Z])' || s.ticker || '([^A-Z]|$)')
            )
          )
          WHERE s.is_genuine_stock = true 
          AND s.detection_confidence >= 0.70
          AND s.ticker NOT IN (SELECT ticker FROM ticker_blacklist)
          GROUP BY s.ticker
        )
        SELECT 
          s.ticker,
          s.exchange,
          COALESCE(ttm.mention_count, 0) as mention_count,
          s.detection_confidence,
          s.ai_confidence,
          s.first_mention_timestamp,
          s.first_mention_author,
          s.is_genuine_stock
        FROM stocks s
        LEFT JOIN today_trader_mentions ttm ON ttm.ticker = s.ticker
        WHERE s.is_genuine_stock = true 
        AND s.detection_confidence >= 0.70
        AND s.ticker NOT IN (SELECT ticker FROM ticker_blacklist)
        AND (
          s.first_mention_author = ANY($1)
          OR ttm.mention_count > 0
        )
        ORDER BY mention_count DESC, s.first_mention_timestamp DESC
        LIMIT 50
      `;
      queryParams = [traders];
    } else {
      query += `
        ORDER BY mention_count DESC, first_mention_timestamp DESC
        LIMIT 50
      `;
    }

    const result = await pool.query(query, queryParams);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching stocks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stocks' },
      { status: 500 }
    );
  }
}
