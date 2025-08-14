import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get('search') || '';
  const ticker = searchParams.get('ticker') || '';
  const tradersParam = searchParams.get('traders');
  const traders = tradersParam ? tradersParam.split(',') : [];
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    let query = `
      SELECT 
        id,
        content,
        timestamp,
        timestamp_edited,
        author_name,
        author_nickname,
        author_avatar_url,
        attachments,
        embeds,
        reactions
      FROM discord_messages
    `;
    
    const params: any[] = [];
    const conditions: string[] = [];
    
    if (ticker) {
      // For ticker search, use case-insensitive regex pattern
      conditions.push(`content ~* $${params.length + 1}`);
      params.push(`\\y${ticker}\\y`); // Word boundary search for ticker
    } else if (search) {
      conditions.push(`(content ILIKE $${params.length + 1} OR author_name ILIKE $${params.length + 1} OR author_nickname ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    
    // Add trader filtering
    if (traders.length > 0) {
      conditions.push(`author_name = ANY($${params.length + 1})`);
      params.push(traders);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY timestamp DESC`;
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM discord_messages';
    const countParams: any[] = [];
    
    const countConditions: string[] = [];
    
    if (ticker) {
      countConditions.push(`content ~* $${countParams.length + 1}`);
      countParams.push(`\\y${ticker}\\y`);
    } else if (search) {
      countConditions.push(`(content ILIKE $${countParams.length + 1} OR author_name ILIKE $${countParams.length + 1} OR author_nickname ILIKE $${countParams.length + 1})`);
      countParams.push(`%${search}%`);
    }
    
    if (traders.length > 0) {
      countConditions.push(`author_name = ANY($${countParams.length + 1})`);
      countParams.push(traders);
    }
    
    if (countConditions.length > 0) {
      countQuery += ` WHERE ${countConditions.join(' AND ')}`;
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);
    
    return NextResponse.json({
      messages: result.rows,
      total,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}
