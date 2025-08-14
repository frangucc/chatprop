// Real-time ticker processor - validates tickers as messages come in
import pool from './db';

export async function processMessageForTickers(message: string, messageId: string) {
  // Extract potential tickers (3-5 letter uppercase patterns)
  const tickerPattern = /\b[A-Z]{3,5}\b/g;
  const matches = message.match(tickerPattern) || [];
  
  // Quick filter for obvious non-tickers
  const excludeWords = ['THE', 'AND', 'FOR', 'WITH', 'FROM', 'THAT', 'THIS', 
    'HAVE', 'WILL', 'YOUR', 'WHAT', 'WHEN', 'WHERE', 'LOL', 'JUST', 'ALL', 
    'ANY', 'ARE', 'ASK', 'NYSE', 'NASDAQ', 'CEO', 'CFO', 'IPO', 'ETF', 
    'FDA', 'SEC', 'USA', 'USD', 'EST', 'CST', 'PST'];
  
  const potentialTickers = [...new Set(matches)].filter(
    ticker => !excludeWords.includes(ticker)
  );
  
  for (const ticker of potentialTickers) {
    try {
      // Check if already validated
      const existing = await pool.query(
        'SELECT ticker, is_genuine_stock FROM stocks WHERE ticker = $1',
        [ticker]
      );
      
      if (existing.rows.length > 0) {
        console.log(`${ticker} already validated: ${existing.rows[0].is_genuine_stock ? 'VALID' : 'FALSE POSITIVE'}`);
        continue;
      }
      
      // Get a few recent messages mentioning this ticker for context
      const context = await pool.query(
        `SELECT content FROM discord_messages 
         WHERE content ~* $1 
         ORDER BY timestamp DESC 
         LIMIT 3`,
        [`\\b${ticker}\\b`]
      );
      
      if (context.rows.length === 0) continue;
      
      // Validate with AI
      const response = await fetch('http://localhost:3000/api/validate-ticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          messages: context.rows.map(r => ({ content: r.content }))
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`New ticker ${ticker}: ${result.isStock ? '✅ VALID' : '❌ FALSE POSITIVE'} (${result.confidence}%)`);
        
        // Only store if it's a real stock with high confidence
        if (result.isStock && result.confidence >= 70) {
          await pool.query(
            `INSERT INTO stock_mentions (ticker, message_id, mention_count)
             VALUES ($1, $2, 1)
             ON CONFLICT (ticker, message_id) DO UPDATE
             SET mention_count = stock_mentions.mention_count + 1`,
            [ticker, messageId]
          );
        }
      }
    } catch (error) {
      console.error(`Error processing ticker ${ticker}:`, error);
    }
  }
}
