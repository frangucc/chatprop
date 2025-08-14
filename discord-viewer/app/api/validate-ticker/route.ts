import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import pool from '@/lib/db';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: Request) {
  try {
    const { ticker, messages } = await request.json();
    
    if (!ticker || !messages || messages.length === 0) {
      return NextResponse.json({ error: 'Missing ticker or messages' }, { status: 400 });
    }

    // Check if we already validated this ticker
    const cached = await pool.query(
      'SELECT * FROM stocks WHERE ticker = $1',
      [ticker]
    );
    
    if (cached.rows.length > 0 && cached.rows[0].ai_confidence !== null) {
      return NextResponse.json({
        ticker,
        isStock: cached.rows[0].is_genuine_stock,
        confidence: cached.rows[0].ai_confidence,
        reason: cached.rows[0].ai_analysis,
        cached: true
      });
    }

    // Prepare context for AI
    const messageContext = messages
      .slice(0, 5)
      .filter((m: any) => m && m.content) // Filter out messages without content
      .map((m: any) => `"${m.content.substring(0, 200)}"`)
      .join('\n');

    // Ask Anthropic to analyze - SIMPLE AND DIRECT
    const completion = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 200,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `Is there a stock ticker in this message?

"${messageContext}"

Focus on "${ticker}" - is it a stock ticker symbol or just a regular word?
Common false positives to watch for: SELL, BUY, HIGH, LOW, MORE, JUST, HOLD, etc.

Reply with JSON only:
{
  "isStock": true/false,
  "confidence": 0-100,
  "reason": "brief explanation"
}`
      }]
    });

    const responseText = completion.content[0].type === 'text' ? completion.content[0].text : '';
    let analysis;
    
    try {
      // Parse AI response
      analysis = JSON.parse(responseText);
    } catch (e) {
      // Fallback parsing
      const isStock = responseText.toLowerCase().includes('"isstock": true') || 
                     responseText.toLowerCase().includes('"isstock":true');
      const confidenceMatch = responseText.match(/"confidence":\s*(\d+)/);
      const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;
      
      analysis = {
        isStock,
        confidence,
        reason: 'AI analysis completed'
      };
    }

    // Save to database
    await pool.query(
      `INSERT INTO stocks (ticker, is_genuine_stock, ai_confidence, ai_analysis, is_valid)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ticker) DO UPDATE SET
         is_genuine_stock = EXCLUDED.is_genuine_stock,
         ai_confidence = EXCLUDED.ai_confidence,
         ai_analysis = EXCLUDED.ai_analysis,
         last_validated = NOW()`,
      [ticker, analysis.isStock, analysis.confidence, analysis.reason, analysis.isStock]
    );

    return NextResponse.json({
      ticker,
      ...analysis,
      cached: false
    });

  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json({ 
      error: 'Failed to validate ticker',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
