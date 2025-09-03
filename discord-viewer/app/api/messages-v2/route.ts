import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Use the new clean database
const pool = new Pool({
  connectionString: process.env.DATABASE2_URL || process.env.DATABASE_URL,
});

// Helper function to parse PostgreSQL ROW format
function parsePostgresRow(rowString: string): { content: string; author: string } | null {
  if (!rowString || rowString === '(,)' || rowString === 'null') {
    return null;
  }
  
  // Remove outer parentheses
  const inner = rowString.slice(1, -1);
  
  // Find the comma that separates content from author
  // We need to be careful about commas within quoted strings
  let inQuotes = false;
  let escapeNext = false;
  let commaIndex = -1;
  
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    
    if (char === ',' && !inQuotes) {
      commaIndex = i;
      break;
    }
  }
  
  if (commaIndex === -1) {
    return null;
  }
  
  let content = inner.slice(0, commaIndex).trim();
  let author = inner.slice(commaIndex + 1).trim();
  
  // Remove quotes if present
  if (content.startsWith('"') && content.endsWith('"')) {
    content = content.slice(1, -1);
  }
  if (author.startsWith('"') && author.endsWith('"')) {
    author = author.slice(1, -1);
  }
  
  // Unescape any escaped characters
  content = content.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  author = author.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  
  return { content, author };
}

// Note: Price extraction removed - prices should come from Databento API instead

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const ticker = searchParams.get('ticker');
  const traders = searchParams.get('traders');
  const range = searchParams.get('range');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');
  
  if (!ticker) {
    return NextResponse.json({ error: 'Ticker parameter is required' }, { status: 400 });
  }

  try {
    // Build the query to get messages mentioning this ticker
    // Also get first mention details for price extraction
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
    
    // Also get first mention details for this ticker
    let firstMentionQuery = `
      SELECT ROW(m2.content, a2.username)
      FROM ticker_detections td2
      JOIN messages m2 ON td2.message_id = m2.id
      JOIN authors a2 ON m2.author_id = a2.id
      WHERE UPPER(td2.ticker_symbol) = UPPER($1)
        AND td2.confidence_score >= 0.7
    `;
    
    let firstMentionParams = [ticker];
    let firstMentionParamIndex = 2;
    
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
    
    // Filter by date range if specified
    if (range && range !== 'all') {
      let dateFilter = '';
      const now = new Date();
      
      if (range === 'today') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        dateFilter = ` AND m.discord_timestamp >= $${paramIndex}`;
        queryParams.push(today.toISOString());
        paramIndex++;
        
        // Also add to first mention query
        firstMentionQuery += ` AND m2.discord_timestamp >= $${firstMentionParamIndex}`;
        firstMentionParams.push(today.toISOString());
        firstMentionParamIndex++;
      } else if (range === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = ` AND m.discord_timestamp >= $${paramIndex}`;
        queryParams.push(weekAgo.toISOString());
        paramIndex++;
        
        firstMentionQuery += ` AND m2.discord_timestamp >= $${firstMentionParamIndex}`;
        firstMentionParams.push(weekAgo.toISOString());
        firstMentionParamIndex++;
      } else if (range === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        dateFilter = ` AND m.discord_timestamp >= $${paramIndex}`;
        queryParams.push(monthAgo.toISOString());
        paramIndex++;
        
        firstMentionQuery += ` AND m2.discord_timestamp >= $${firstMentionParamIndex}`;
        firstMentionParams.push(monthAgo.toISOString());
        firstMentionParamIndex++;
      }
      
      query += dateFilter;
    }
    
    // Complete first mention query
    firstMentionQuery += ` ORDER BY m2.discord_timestamp ASC LIMIT 1`;
    
    // Order by timestamp descending (newest first)
    query += ` ORDER BY m.discord_timestamp DESC`;
    
    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);
    
    // Execute both queries
    const [result, firstMentionResult] = await Promise.all([
      pool.query(query, queryParams),
      pool.query(firstMentionQuery, firstMentionParams)
    ]);
    
    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT m.id) as total
      FROM ticker_detections td
      JOIN messages m ON td.message_id = m.id
      JOIN authors a ON m.author_id = a.id
      WHERE UPPER(td.ticker_symbol) = UPPER($1)
    `;
    
    const countParams: any[] = [ticker];
    let countParamIndex = 2;
    
    if (traders) {
      const traderList = traders.split(',').filter(Boolean);
      if (traderList.length > 0) {
        const placeholders = traderList.map((_, i) => `$${countParamIndex + i}`).join(',');
        countQuery += ` AND a.username IN (${placeholders})`;
        countParams.push(...traderList);
        countParamIndex += traderList.length;
      }
    }
    
    // Add date range filter to count query as well
    if (range && range !== 'all') {
      const now = new Date();
      
      if (range === 'today') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        countQuery += ` AND m.discord_timestamp >= $${countParamIndex}`;
        countParams.push(today.toISOString());
      } else if (range === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        countQuery += ` AND m.discord_timestamp >= $${countParamIndex}`;
        countParams.push(weekAgo.toISOString());
      } else if (range === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        countQuery += ` AND m.discord_timestamp >= $${countParamIndex}`;
        countParams.push(monthAgo.toISOString());
      }
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0');
    
    // Process first mention details (author only - prices come from Databento API)
    let firstMentionPrice = null; // Always null - prices handled by Databento API
    let firstMentionAuthor = null;
    
    if (firstMentionResult.rows.length > 0) {
      const firstMentionRow = firstMentionResult.rows[0].row;
      const parsed = parsePostgresRow(firstMentionRow);
      
      if (parsed) {
        // Clean up author name (remove junk characters)
        firstMentionAuthor = parsed.author.replace(/[^a-zA-Z0-9_@.-]/g, '');
      }
    }
    
    return NextResponse.json({
      messages: result.rows,
      total,
      limit,
      offset,
      firstMentionPrice,
      firstMentionAuthor
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
