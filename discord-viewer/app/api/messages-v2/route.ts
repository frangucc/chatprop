import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Use the new clean database
const pool = new Pool({
  connectionString: process.env.DATABASE2_URL || process.env.DATABASE_URL,
});

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const ticker = searchParams.get('ticker');
  const traders = searchParams.get('traders');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');
  
  if (!ticker) {
    return NextResponse.json({ error: 'Ticker parameter is required' }, { status: 400 });
  }

  try {
    // Build the query to get messages mentioning this ticker
    let query = `
      SELECT DISTINCT
        m.id,
        m.content,
        m.discord_timestamp as timestamp,
        m.edited_at as timestamp_edited,
        a.username as author_name,
        a.username as author_nickname,
        a.avatar_url as author_avatar_url,
        '[]'::jsonb as attachments,
        '[]'::jsonb as embeds,
        '[]'::jsonb as reactions
      FROM ticker_detections td
      JOIN messages m ON td.message_id = m.id
      JOIN authors a ON m.author_id = a.id
      WHERE UPPER(td.ticker_symbol) = UPPER($1)
    `;
    
    const queryParams: any[] = [ticker];
    let paramIndex = 2;
    
    // Filter by traders if specified
    if (traders) {
      const traderList = traders.split(',').filter(Boolean);
      if (traderList.length > 0) {
        const placeholders = traderList.map((_, i) => `$${paramIndex + i}`).join(',');
        query += ` AND a.username IN (${placeholders})`;
        queryParams.push(...traderList);
        paramIndex += traderList.length;
      }
    }
    
    // Order by timestamp descending (newest first)
    query += ` ORDER BY m.discord_timestamp DESC`;
    
    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);
    
    const result = await pool.query(query, queryParams);
    
    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT m.id) as total
      FROM ticker_detections td
      JOIN messages m ON td.message_id = m.id
      JOIN authors a ON m.author_id = a.id
      WHERE UPPER(td.ticker_symbol) = UPPER($1)
    `;
    
    const countParams: any[] = [ticker];
    
    if (traders) {
      const traderList = traders.split(',').filter(Boolean);
      if (traderList.length > 0) {
        const placeholders = traderList.map((_, i) => `$${2 + i}`).join(',');
        countQuery += ` AND a.username IN (${placeholders})`;
        countParams.push(...traderList);
      }
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0');
    
    return NextResponse.json({
      messages: result.rows,
      total,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch messages',
        details: error instanceof Error ? error.message : 'Unknown error',
        query: error instanceof Error && 'query' in error ? (error as any).query : undefined
      },
      { status: 500 }
    );
  }
}
