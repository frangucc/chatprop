import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
        author_name,
        MAX(author_nickname) as author_nickname,
        MAX(author_avatar_url) as author_avatar_url,
        COUNT(DISTINCT ticker) as stocks_mentioned,
        MAX(last_activity) as last_activity
      FROM (
        SELECT DISTINCT 
          dm.author_name,
          dm.author_nickname,
          dm.author_avatar_url,
          s.ticker,
          dm.timestamp as last_activity
        FROM discord_messages dm
        INNER JOIN stocks s ON dm.author_name = s.first_mention_author
        WHERE (
          LOWER(dm.author_name) LIKE $1 
          OR LOWER(COALESCE(dm.author_nickname, dm.author_name)) LIKE $1
        )
        AND dm.author_name IS NOT NULL
      ) subq
      GROUP BY author_name
      ORDER BY stocks_mentioned DESC, last_activity DESC
      LIMIT 10
    `, [`%${searchTerm}%`]);

    const users = result.rows.map(row => ({
      username: row.author_name,
      nickname: row.author_nickname,
      avatar: row.author_avatar_url,
      stocksMentioned: parseInt(row.stocks_mentioned),
      lastActivity: row.last_activity
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
