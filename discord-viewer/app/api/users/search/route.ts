import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Use the new clean database
const pool = new Pool({
  connectionString: process.env.DATABASE2_URL || process.env.DATABASE_URL,
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    
    if (!query || query.length < 2) {
      return NextResponse.json([]);
    }
    
    // Search for Discord users who have mentioned stocks
    // Remove @ if present and search case-insensitively
    const searchTerm = query.replace('@', '').toLowerCase();
    
    const result = await pool.query(`
      SELECT 
        a.username,
        a.username as author_nickname,
        a.avatar_url,
        COUNT(DISTINCT td.ticker_symbol) as stocks_mentioned,
        MAX(m.discord_timestamp) as last_activity,
        a.is_trader
      FROM authors a
      LEFT JOIN messages m ON a.id = m.author_id
      LEFT JOIN ticker_detections td ON m.id = td.message_id
      WHERE LOWER(a.username) LIKE $1
      GROUP BY a.id, a.username, a.avatar_url, a.is_trader
      ORDER BY stocks_mentioned DESC, last_activity DESC NULLS LAST
      LIMIT 10
    `, [`%${searchTerm}%`]);

    const users = result.rows.map(row => ({
      username: row.username,
      nickname: row.author_nickname,
      avatar: row.avatar_url,
      stocksMentioned: parseInt(row.stocks_mentioned) || 0,
      lastActivity: row.last_activity,
      isTrader: row.is_trader || false
    }));

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error searching users:', error);
    return NextResponse.json(
      { error: 'Failed to search users' },
      { status: 500 }
    );
  }
}
