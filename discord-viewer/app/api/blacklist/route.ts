import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE2_URL,
  ssl: { rejectUnauthorized: false }
});

export async function POST(request: NextRequest) {
  try {
    const { ticker, reason, contextNote, exampleMessages } = await request.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    // Add to blacklist
    await pool.query(`
      INSERT INTO ticker_blacklist (ticker, reason, context_note, example_messages, added_by) 
      VALUES ($1, $2, $3, $4, 'user')
      ON CONFLICT (ticker) DO UPDATE SET 
        reason = EXCLUDED.reason,
        context_note = EXCLUDED.context_note,
        example_messages = EXCLUDED.example_messages
    `, [ticker.toUpperCase(), reason || 'User marked as false positive', contextNote, exampleMessages]);

    // Remove from stocks table
    await pool.query(`
      DELETE FROM stocks WHERE ticker = $1
    `, [ticker.toUpperCase()]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error adding to blacklist:', error);
    return NextResponse.json(
      { error: 'Failed to add to blacklist' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT ticker, reason, context_note, created_at 
      FROM ticker_blacklist 
      ORDER BY created_at DESC
    `);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching blacklist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blacklist' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    await pool.query(`
      DELETE FROM ticker_blacklist WHERE ticker = $1
    `, [ticker.toUpperCase()]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing from blacklist:', error);
    return NextResponse.json(
      { error: 'Failed to remove from blacklist' },
      { status: 500 }
    );
  }
}
