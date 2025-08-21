const { Pool } = require('pg');

class TickerExtractor {
  constructor(databaseUrl, anthropicApiKey) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });
    
    this.anthropicKey = anthropicApiKey;
    
    // Cache for blacklisted tickers
    this.blacklistedTickers = new Set();
    this.blacklistData = new Map();
    this.blacklistLoaded = false;
    // Regex patterns from YAML config
    this.patterns = {
      cashtag: /\$[A-Za-z]{1,5}([.-][A-Za-z0-9]{1,3})?/g,
      allCaps: /\b[A-Z]{2,5}([.-][A-Za-z0-9]{1,3})?\b/g,
      mixedCase: /\b[A-Za-z]{3,5}([.-][A-Za-z0-9]{1,3})?\b/g,
      singleLetter: /\b[A-Z]\b/g
    };
    
    // Trading context indicators
    this.traderVerbs = new Set([
      'in', 'out', 'over', 'above', 'below', 'break', 'hold', 'starter', 
      'added', 'halt', 'pop', 'runner', 'WW', 'day 2', 'calls', 'puts',
      'long', 'short', 'entry', 'exit', 'target', 'stop', 'bounce'
    ]);
    
    this.priceIndicators = new Set([
      '$', 'pt', 'target', 'SL', 'TP', 'EMA', 'support', 'resistance',
      'breakout', 'breakdown', 'squeeze', 'momentum'
    ]);
    
    // Common stopwords that look like tickers
    this.stopwords = new Set([
      'CAN', 'ALL', 'ONE', 'IT', 'FOR', 'WAS', 'YOU', 'MAY', 'ANY', 'ARE',
      'THE', 'AND', 'BUT', 'NOT', 'OUT', 'NOW', 'HOW', 'NEW', 'WHO', 'WHY',
      'SELL', 'BUY', 'HIGH', 'LOW', 'HOLD', 'MORE', 'JUST', 'WHAT', 'WHEN',
      'WHERE', 'LOL', 'ASK', 'NYSE', 'NASDAQ', 'CEO', 'CFO', 'IPO', 'ETF',
      'FDA', 'SEC', 'USA', 'USD', 'EST', 'CST', 'PST', 'HOD', 'LOD', 'ATH', 'ATL'
    ]);
    
    // Confidence scoring weights
    this.weights = {
      cashtag_exact_db: 0.95,
      all_caps_db_with_context: 0.85,
      mixed_lowercase_db_with_context: 0.70,
      all_caps_db_no_context: 0.60,
      stopword_penalty: -0.40,
      stopword_no_context_penalty: -0.20,
      price_context_bonus: 0.10,
      halt_bonus: 0.05
    };
    
    this.thresholds = {
      accept: 0.80,
      low_confidence_min: 0.60,
      low_confidence_max: 0.79
    };

    // Prefer legacy listed_securities if present; fallback to v2 tickers table
    this.useListedSecurities = true;
  }

  // Normalize ticker variants (BRK-B -> BRK.B)
  normalizeTicker(ticker) {
    return ticker
      .toUpperCase()
      .replace(/[-\s]/g, '.')  // Convert separators to dots
      .replace(/[^\w.]/g, '') // Remove trailing punctuation/emojis
      .trim();
  }

  // Extract all potential ticker candidates from message
  extractCandidates(messageText) {
    const candidates = new Map();
    const text = messageText || '';
    
    // 1. Cashtags (highest priority)
    const cashtags = [...text.matchAll(this.patterns.cashtag)];
    cashtags.forEach(match => {
      const ticker = this.normalizeTicker(match[0].substring(1)); // Remove $
      if (ticker.length >= 1 && ticker.length <= 5) {
        candidates.set(ticker, {
          ticker,
          method: 'cashtag',
          original: match[0],
          confidence: 0.95 // Base confidence for cashtags
        });
      }
    });
    
    // 2. All-caps tokens
    const allCaps = [...text.matchAll(this.patterns.allCaps)];
    allCaps.forEach(match => {
      const ticker = this.normalizeTicker(match[0]);
      if (ticker.length >= 2 && ticker.length <= 5 && !candidates.has(ticker)) {
        candidates.set(ticker, {
          ticker,
          method: 'all_caps',
          original: match[0],
          confidence: 0.60 // Base confidence
        });
      }
    });
    
    // 3. Mixed case (only if preceded by $ or exact DB match)
    const mixedCase = [...text.matchAll(this.patterns.mixedCase)];
    mixedCase.forEach(match => {
      const ticker = this.normalizeTicker(match[0]);
      if (ticker.length >= 3 && ticker.length <= 5 && !candidates.has(ticker)) {
        // Check if preceded by $
        const index = match.index;
        const precedingChar = index > 0 ? text[index - 1] : '';
        
        if (precedingChar === '$') {
          candidates.set(ticker, {
            ticker,
            method: 'mixed_case_cashtag',
            original: match[0],
            confidence: 0.85
          });
        } else {
          // Will validate against DB later
          candidates.set(ticker, {
            ticker,
            method: 'mixed_case',
            original: match[0],
            confidence: 0.30 // Low initial confidence
          });
        }
      }
    });
    
    // 4. Single letters (only if cashtag or all-caps with context)
    const singleLetters = [...text.matchAll(this.patterns.singleLetter)];
    singleLetters.forEach(match => {
      const ticker = match[0];
      const index = match.index;
      const precedingChar = index > 0 ? text[index - 1] : '';
      
      if (precedingChar === '$' && !candidates.has(ticker)) {
        candidates.set(ticker, {
          ticker,
          method: 'single_letter_cashtag',
          original: match[0],
          confidence: 0.90
        });
      }
    });
    
    return Array.from(candidates.values());
  }

  // Calculate confidence score based on context
  calculateConfidence(candidate, messageText, hasTraderContext, hasPriceContext) {
    let confidence = candidate.confidence;
    const ticker = candidate.ticker;
    
    // Apply stopword penalty
    if (this.stopwords.has(ticker) && candidate.method !== 'cashtag') {
      confidence += this.weights.stopword_penalty;
      if (!hasTraderContext) {
        confidence += this.weights.stopword_no_context_penalty;
      }
    }
    
    // Boost for trader context
    if (hasTraderContext) {
      if (candidate.method === 'all_caps') {
        confidence = Math.max(confidence, this.weights.all_caps_db_with_context);
      } else if (candidate.method === 'mixed_case') {
        confidence = Math.max(confidence, this.weights.mixed_lowercase_db_with_context);
      }
    }
    
    // Boost for price context
    if (hasPriceContext) {
      confidence += this.weights.price_context_bonus;
    }
    
    // Check for halt language
    const haltTerms = /\b(halt|T1|T2|resume|halted)\b/i;
    if (haltTerms.test(messageText)) {
      confidence += this.weights.halt_bonus;
    }
    
    // Cap at [0, 1]
    return Math.max(0, Math.min(1, confidence));
  }

  // Detect trading context in message
  detectContext(messageText) {
    const text = messageText.toLowerCase();
    
    const hasTraderContext = Array.from(this.traderVerbs).some(verb => 
      text.includes(verb.toLowerCase())
    );
    
    const hasPriceContext = Array.from(this.priceIndicators).some(indicator => 
      text.includes(indicator.toLowerCase())
    ) || /\$?\d+\.?\d*/.test(text); // Numbers that could be prices
    
    return { hasTraderContext, hasPriceContext };
  }

  // Load blacklisted tickers from database
  async loadBlacklist() {
    try {
      const result = await this.pool.query(`
        SELECT 
          ticker, 
          reason,
          min_confidence_required,
          requires_cashtag,
          requires_price_context,
          is_permanent
        FROM ticker_blacklist
      `);
      this.blacklistedTickers = new Set(result.rows.map(row => row.ticker));
      this.blacklistData = new Map(result.rows.map(row => [
        row.ticker,
        {
          reason: row.reason,
          minConfidence: row.min_confidence_required,
          requiresCashtag: row.requires_cashtag,
          requiresPriceContext: row.requires_price_context,
          isPermanent: row.is_permanent
        }
      ]));
      this.blacklistLoaded = true;
      console.log(`Loaded ${this.blacklistedTickers.size} blacklisted tickers`);
    } catch (error) {
      console.error('Error loading blacklist:', error);
      this.blacklistLoaded = true; // Set to true even on error to avoid blocking
    }
  }

  // Initialize the extractor (must be called before processing)
  async initialize() {
    await this.loadBlacklist();
    console.log('TickerExtractor initialized with blacklist');
  }

  // Check if ticker is blacklisted
  isBlacklisted(ticker) {
    return this.blacklistedTickers.has(ticker.toUpperCase());
  }

  // Validate ticker against NEON database
  async validateTicker(ticker) {
    try {
      if (this.useListedSecurities) {
        const result = await this.pool.query(`
          SELECT ticker, exchange, security_type, is_active 
          FROM listed_securities 
          WHERE ticker = $1 
          AND exchange IN ('NASDAQ', 'NYSE', 'AMEX')
          AND security_type IN ('Common', 'ADR', 'ETF', 'Share Class')
          AND is_active = true
        `, [ticker]);
        return result.rows.length > 0 ? result.rows[0] : null;
      } else {
        // v2 schema: use tickers table as canonical list
        const result = await this.pool.query(`
          SELECT symbol AS ticker, exchange, is_active 
          FROM tickers
          WHERE symbol = $1 AND is_active = true
        `, [ticker]);
        return result.rows.length > 0 ? result.rows[0] : null;
      }
    } catch (error) {
      // If legacy table doesn't exist, fallback to v2 tickers and retry once
      if (this.useListedSecurities && error && error.code === '42P01') {
        this.useListedSecurities = false;
        try {
          const result = await this.pool.query(`
            SELECT symbol AS ticker, exchange, is_active 
            FROM tickers
            WHERE symbol = $1 AND is_active = true
          `, [ticker]);
          return result.rows.length > 0 ? result.rows[0] : null;
        } catch (e2) {
          console.error(`Error validating ticker ${ticker} via v2 tickers:`, e2);
          return null;
        }
      }
      console.error(`Error validating ticker ${ticker}:`, error);
      return null;
    }
  }

  // Call Anthropic AI for validation
  async validateWithAI(ticker, contextMessages) {
    if (!this.anthropicKey) return null;
    
    try {
      const context = contextMessages.map(msg => msg.content).join('\n');
      const isBlacklisted = this.isBlacklisted(ticker);
      const messageCount = contextMessages.length;
      
      // Build concise blacklist information from available fields
      const blacklistInfo = Array.from(this.blacklistData.entries())
        .map(([tkr, data]) => {
          const flags = [
            data.isPermanent ? 'permanent' : null,
            data.requiresCashtag ? 'requires_cashtag' : null,
            data.requiresPriceContext ? 'requires_price' : null,
            data.minConfidence ? `min_conf ${data.minConfidence}` : null
          ].filter(Boolean).join(', ');
          return `${tkr}: ${data.reason}${flags ? ` | ${flags}` : ''}`;
        })
        .join('\n');
      
      const prompt = `You are a financial expert analyzing Discord trading chat messages to determine if "${ticker}" is a genuine stock ticker symbol.

Context messages (${messageCount} total):
${context}

BLACKLIST STATUS: ${isBlacklisted ? 'This ticker is currently blacklisted as a false positive' : 'Not blacklisted'}

${isBlacklisted ? `
SPECIAL CASE: This ticker "${ticker}" is blacklisted but being re-evaluated because:
- It has ${messageCount} mentions (suggesting possible legitimacy)
- Strong trading context detected in messages
- You should be EXTRA STRICT and only validate if there's overwhelming evidence it's a real stock being traded
` : ''}

DETAILED BLACKLIST WITH CONTEXT NOTES:
${blacklistInfo}

Please analyze if "${ticker}" is:
1. A real stock ticker symbol (like AAPL, TSLA, NVDA, PLAY, LOW)
2. Being used in a genuine trading/investment context with prices, targets, or positions
3. NOT just a common English word being used normally
4. NOT a trading term (HOD, LOD, IPO, CEO, etc.)

${isBlacklisted ? 'EXTRA STRICT: Since this is blacklisted, require very strong evidence of genuine stock trading context.' : ''}

Respond with JSON only:
{
  "is_genuine_stock": boolean,
  "confidence": number (0.0-1.0),
  "reasoning": "brief explanation"
}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });
      
      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status}`);
      }
      
      const data = await response.json();
      const content = data.content[0].text;
      
      try {
        return JSON.parse(content);
      } catch {
        // Fallback parsing
        const isStock = /is_genuine_stock['":\s]*true/i.test(content);
        const confidenceMatch = content.match(/confidence['":\s]*([0-9.]+)/i);
        const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
        
        return {
          is_genuine_stock: isStock,
          confidence: confidence,
          reasoning: 'Parsed from AI response'
        };
      }
    } catch (error) {
      console.error('AI validation error:', error);
      return null;
    }
  }

  // Process a single message for tickers
  async processSingleMessage(messageId, messageText, authorId, timestamp) {
    const candidates = this.extractCandidates(messageText);
    const { hasTraderContext, hasPriceContext } = this.detectContext(messageText);
    const results = [];
    
    for (const candidate of candidates) {
      // Calculate initial confidence
      const confidence = this.calculateConfidence(
        candidate, 
        messageText, 
        hasTraderContext, 
        hasPriceContext
      );
      
      // Skip if confidence too low
      if (confidence < this.thresholds.low_confidence_min) {
        continue;
      }

      // Smart blacklist handling based on mention count and context (guarded)
      if (this.isBlacklisted(candidate.ticker)) {
        const mentionCount = (candidate.count ?? 1);
        // For low mention count (1-2), strictly enforce blacklist
        if (mentionCount <= 2) {
          console.log(`Skipping blacklisted ticker with low mentions: ${candidate.ticker} (${mentionCount} mentions)`);
          continue;
        }
        // For higher mention counts, allow re-evaluation if it looks like genuine trading context
        const contexts = Array.isArray(candidate.contexts) ? candidate.contexts : [];
        const hasStrongTradingContext = contexts.some(ctx =>
          /\$[A-Z]+|price|target|buy|sell|calls|puts|strike|expiry|volume/i.test(ctx.content || '')
        );
        if (!hasStrongTradingContext) {
          console.log(`Skipping blacklisted ticker without strong trading context: ${candidate.ticker}`);
          continue;
        }
        console.log(`Re-evaluating blacklisted ticker with strong context: ${candidate.ticker} (${mentionCount} mentions)`);
      }
      
      // Database validation - check if ticker exists in our allowed exchanges
      const dbValidation = await this.validateTicker(candidate.ticker);
      if (dbValidation) {
        // If found in database, boost confidence
        candidate.confidence = Math.min(candidate.confidence + 0.10, 1.0);
        candidate.exchange = dbValidation.exchange;
      }
      // Continue processing even if not in database - let AI validate
      
      let finalConfidence = confidence;
      let aiValidation = null;
      
      // Use AI validation for borderline cases
      if (confidence >= this.thresholds.low_confidence_min && 
          confidence < this.thresholds.accept) {
        
        // Get context messages
        const contextMessages = await this.getContextMessages(candidate.ticker, messageId);
        aiValidation = await this.validateWithAI(candidate.ticker, contextMessages);
        
        if (aiValidation && aiValidation.is_genuine_stock) {
          finalConfidence = Math.max(finalConfidence, aiValidation.confidence);
        } else if (aiValidation) {
          finalConfidence = Math.min(finalConfidence, 0.3); // Penalize AI rejection
        }
      }
      
      // Accept if confidence meets threshold
      if (finalConfidence >= this.thresholds.accept) {
        const detection = {
          ticker: candidate.ticker,
          exchange: dbValidation?.exchange || 'UNKNOWN',
          source_message_id: messageId,
          message_text: messageText,
          detection_confidence: finalConfidence,
          detection_method: candidate.method + (aiValidation ? '_ai_validated' : ''),
          observed_at: timestamp,
          author_name: authorId, // This should be the Discord username, not ID
          ai_confidence: aiValidation?.confidence || null,
          is_genuine_stock: aiValidation?.is_genuine_stock !== false
        };
        
        results.push(detection);
        
        // Store in database (v2 schema)
        await this.storeTicker(detection);
      }
    }
    
    return results;
  }

  // Get context messages for AI validation
  async getContextMessages(ticker, excludeMessageId) {
    try {
      const result = await this.pool.query(`
        SELECT content, author_id, discord_timestamp AS ts
        FROM messages 
        WHERE content ~* $1 
          AND id != $2
        ORDER BY discord_timestamp DESC 
        LIMIT 5
      `, [`\\b${ticker}\\b`, excludeMessageId]);
      
      return result.rows;
    } catch (error) {
      console.error('Error getting context messages:', error);
      return [];
    }
  }

  // Store ticker detection in database (v2 schema)
  async storeTicker(detection) {
    try {
      // Ensure ticker exists in master list (insert if missing)
      await this.pool.query(
        `INSERT INTO tickers (symbol, exchange, is_active)
         VALUES ($1, $2, true)
         ON CONFLICT (symbol) DO NOTHING`,
        [detection.ticker, detection.exchange || 'UNKNOWN']
      );

      // Insert detection record
      await this.pool.query(
        `INSERT INTO ticker_detections (
           message_id,
           ticker_symbol,
           detection_method,
           confidence_score,
           context_strength,
           position_in_message,
           detected_text
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [
          String(detection.source_message_id),
          detection.ticker,
          detection.detection_method || 'unknown',
          detection.detection_confidence ?? 0.0,
          null,
          null,
          (detection.message_text || '').substring(0, 50)
        ]
      );

      return true;
    } catch (error) {
      console.error('Error storing ticker:', error);
      return false;
    }
  }

  // Process messages in batch (for catch-up)
  async processBatch(messages, concurrency = 3) {
    const results = [];
    
    // Process in chunks to avoid overwhelming the AI API
    for (let i = 0; i < messages.length; i += concurrency) {
      const chunk = messages.slice(i, i + concurrency);
      
      const chunkPromises = chunk.map(async (message) => {
        try {
          return await this.processSingleMessage(
            message.id,
            message.content,
            message.author_id,
            message.timestamp
          );
        } catch (error) {
          console.error(`Error processing message ${message.id}:`, error);
          return [];
        }
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults.flat());
      
      // Small delay between chunks to respect rate limits
      if (i + concurrency < messages.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  // Get today's messages for batch processing
  async getTodaysMessages() {
    try {
      const result = await this.pool.query(`
        SELECT id, content, author_id, discord_timestamp AS timestamp
        FROM messages 
        WHERE discord_timestamp >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago')
        ORDER BY discord_timestamp ASC
      `);
      
      return result.rows;
    } catch (error) {
      console.error('Error getting today\'s messages:', error);
      return [];
    }
  }

  // Close database connection
  async close() {
    await this.pool.end();
  }
}

module.exports = TickerExtractor;
