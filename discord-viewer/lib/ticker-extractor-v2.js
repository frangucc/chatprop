const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

class TickerExtractorV2 {
  constructor(databaseUrl, anthropicKey = null) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });
    
    this.anthropicKey = anthropicKey;
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
    
    // Cached data
    this.blacklistedTickers = new Set();
    this.blacklistData = new Map(); // ticker -> {reason, contextNote, examples}
    this.validatedTickers = new Map(); // ticker -> exchange data
    this.contextualBlacklist = new Map(); // ticker -> context rules
    
    // STRICT extraction patterns - much more conservative
    this.patterns = {
      // Only accept explicit cashtags
      cashtag: /\$([A-Z]{1,5}(?:\.[A-Z]{1,3})?)/gi,
      
      // ALL-CAPS only (not mixed case unless cashtagged)
      allCapsStrict: /\b([A-Z]{2,5}(?:\.[A-Z]{1,3})?)\b/g,
      
      // Single letter ONLY if cashtagged
      singleLetterCashtag: /\$([A-Z])\b/gi
    };
    
    // Trading context indicators - REQUIRED for non-cashtag extraction
    this.strongTradingVerbs = new Set([
      'bought', 'sold', 'buying', 'selling', 'entered', 'exited', 'added',
      'dumped', 'loaded', 'accumulating', 'scaling', 'starter', 'position'
    ]);
    
    // Price/target indicators
    this.priceIndicators = [
      /\$\d+\.?\d*/,  // Dollar amounts
      /\d+\.?\d*\s*(pt|PT|target|Target)/,  // Price targets
      /\b(over|under|above|below)\s+\d+/i,  // Price levels
      /\b\d+\s*(calls?|puts?)\b/i  // Options
    ];
    
    // Extended stopwords - words that should NEVER be tickers unless cashtagged
    this.hardStopwords = new Set([
      // Common English words
      'THE', 'AND', 'FOR', 'ARE', 'NOT', 'BUT', 'ALL', 'ONE', 'CAN', 'HAS', 
      'HAD', 'WAS', 'HIS', 'HER', 'ITS', 'ANY', 'NOW', 'NEW', 'OLD', 'WHO',
      'WHY', 'HOW', 'OUT', 'GET', 'GOT', 'HIM', 'SHE', 'YOU', 'MAY', 'WAY',
      'USE', 'SAY', 'RUN', 'BIG', 'TOP', 'END', 'TRY', 'ASK', 'RAN', 'SET',
      'LOT', 'FEW', 'OFF', 'BAD', 'PUT', 'SAW', 'FAR', 'OWN', 'DAY', 'DID',
      'CAR', 'LET', 'SUN', 'BIG', 'MAN', 'FAX', 'JOB', 'AGO', 'PAY', 'TAX',
      
      // Trading terms that aren't stocks
      'BUY', 'SELL', 'HOLD', 'LONG', 'SHORT', 'HIGH', 'LOW', 'CALL', 'PUT',
      'NYSE', 'NASDAQ', 'AMEX', 'OTC', 'IPO', 'CEO', 'CFO', 'ETF', 'FDA',
      'SEC', 'USA', 'USD', 'EUR', 'GBP', 'JPY', 'EST', 'CST', 'PST', 'GMT',
      'HOD', 'LOD', 'ATH', 'ATL', 'RSI', 'MACD', 'EMA', 'SMA', 'VWAP',
      'PDT', 'DD', 'YOLO', 'FOMO', 'FUD', 'HODL', 'MOON', 'BEAR', 'BULL',
      'RED', 'GREEN', 'WIN', 'LOSS', 'GAIN', 'DROP', 'PUMP', 'DUMP', 'DIP',
      'RIP', 'GUH', 'ROPE', 'WIFE', 'KIDS', 'RENT', 'FOOD', 'BILL', 'BANK',
      
      // Common false positives from Discord
      'LOL', 'LMAO', 'WTF', 'OMG', 'IMO', 'IMHO', 'TBH', 'IDK', 'BTW', 'FYI',
      'ASAP', 'FAQ', 'DM', 'PM', 'EDIT', 'POST', 'LINK', 'JOIN', 'LEAVE',
      'MUTE', 'BAN', 'KICK', 'ADMIN', 'MOD', 'BOT', 'SPAM', 'SCAM', 'FAKE'
    ]);
    
    // Contextual words that might be stocks but need STRONG evidence
    this.contextualWords = new Set([
      'ADD', 'GO', 'BE', 'DO', 'SO', 'UP', 'ON', 'AT', 'BY', 'OR', 'IF',
      'IS', 'IT', 'AS', 'TO', 'WE', 'HE', 'ME', 'MY', 'NO', 'OK'
    ]);
    
    // Confidence thresholds
    this.thresholds = {
      autoAccept: 0.90,        // Immediate acceptance
      requireValidation: 0.70,  // Needs AI validation
      autoReject: 0.50          // Immediate rejection
    };
  }

  async initialize() {
    await this.loadBlacklist();
    await this.loadValidatedTickers();
    console.log('🚀 TickerExtractorV2 initialized');
  }

  async loadBlacklist() {
    try {
      const result = await this.pool.query(`
        SELECT ticker, reason, context_note, example_messages 
        FROM ticker_blacklist
      `);
      
      for (const row of result.rows) {
        this.blacklistedTickers.add(row.ticker);
        this.blacklistData.set(row.ticker, {
          reason: row.reason,
          contextNote: row.context_note,
          examples: row.example_messages || []
        });
        
        // Parse context rules from notes for smarter filtering
        if (row.context_note) {
          this.parseContextRules(row.ticker, row.context_note);
        }
      }
      
      console.log(`📋 Loaded ${this.blacklistedTickers.size} blacklisted tickers with context`);
    } catch (error) {
      console.error('Error loading blacklist:', error);
    }
  }

  parseContextRules(ticker, contextNote) {
    // Extract rules like "only valid when talking about pharma" or "common word unless price mentioned"
    const rules = {
      requiresPhrases: [],
      excludesPhrases: [],
      requiresContext: null
    };
    
    if (contextNote.includes('pharma')) rules.requiresContext = 'pharmaceutical';
    if (contextNote.includes('price')) rules.requiresPhrases.push('price', '$', 'target');
    if (contextNote.includes('common word')) rules.excludesPhrases.push('I', 'you', 'we', 'they');
    
    this.contextualBlacklist.set(ticker, rules);
  }

  async loadValidatedTickers() {
    try {
      const result = await this.pool.query(`
        SELECT ticker, exchange 
        FROM stocks 
        WHERE is_genuine_stock = true 
        AND detection_confidence >= 0.80
      `);
      
      for (const row of result.rows) {
        this.validatedTickers.set(row.ticker, row.exchange);
      }
      
      console.log(`✅ Loaded ${this.validatedTickers.size} validated tickers`);
    } catch (error) {
      console.error('Error loading validated tickers:', error);
    }
  }

  normalizeTicker(ticker) {
    return ticker
      .toUpperCase()
      .replace(/[-\s]/g, '.')  // BRK-B -> BRK.B
      .replace(/[^\w.]/g, '') // Remove special chars
      .trim();
  }

  hasStrongTradingContext(text) {
    const lowerText = text.toLowerCase();
    
    // Check for trading verbs
    const hasTradingVerb = Array.from(this.strongTradingVerbs).some(verb => 
      new RegExp(`\\b${verb}\\b`, 'i').test(lowerText)
    );
    
    // Check for price indicators
    const hasPriceIndicator = this.priceIndicators.some(pattern => 
      pattern.test(text)
    );
    
    // Check for position sizes
    const hasPositionSize = /\b\d+k?\s*(shares?|position|@)/i.test(text);
    
    // Check for technical levels
    const hasTechnicalLevel = /\b(support|resistance|breakout|breakdown|squeeze|gap)/i.test(lowerText);
    
    return {
      hasTradingVerb,
      hasPriceIndicator,
      hasPositionSize,
      hasTechnicalLevel,
      strength: [hasTradingVerb, hasPriceIndicator, hasPositionSize, hasTechnicalLevel]
        .filter(Boolean).length / 4
    };
  }

  extractCandidates(messageText) {
    const candidates = new Map();
    const text = messageText || '';
    
    // 1. CASHTAGS - Highest priority, always extract
    const cashtags = [...text.matchAll(this.patterns.cashtag)];
    for (const match of cashtags) {
      const ticker = this.normalizeTicker(match[1]);
      if (ticker.length >= 1 && ticker.length <= 5) {
        candidates.set(ticker, {
          ticker,
          method: 'cashtag',
          original: match[0],
          baseConfidence: 0.95
        });
      }
    }
    
    // 2. Single letter cashtags
    const singleCashtags = [...text.matchAll(this.patterns.singleLetterCashtag)];
    for (const match of singleCashtags) {
      const ticker = match[1].toUpperCase();
      if (!candidates.has(ticker)) {
        candidates.set(ticker, {
          ticker,
          method: 'cashtag',
          original: match[0],
          baseConfidence: 0.90
        });
      }
    }
    
    // 3. ALL-CAPS tokens - ONLY with strong context
    const context = this.hasStrongTradingContext(text);
    
    // Only extract all-caps if there's meaningful trading context
    if (context.strength >= 0.5) {
      const allCaps = [...text.matchAll(this.patterns.allCapsStrict)];
      for (const match of allCaps) {
        const ticker = this.normalizeTicker(match[1]);
        
        // Skip if already found as cashtag
        if (candidates.has(ticker)) continue;
        
        // Skip hard stopwords unless cashtagged
        if (this.hardStopwords.has(ticker)) continue;
        
        // Contextual words need even stronger evidence
        if (this.contextualWords.has(ticker) && context.strength < 0.75) continue;
        
        if (ticker.length >= 2 && ticker.length <= 5) {
          candidates.set(ticker, {
            ticker,
            method: 'all_caps',
            original: match[0],
            baseConfidence: 0.60 + (context.strength * 0.25) // 0.60-0.85 based on context
          });
        }
      }
    }
    
    return Array.from(candidates.values());
  }

  async validateCandidate(candidate, messageText, messageId, authorName) {
    const ticker = candidate.ticker;
    
    // Check if blacklisted
    if (this.blacklistedTickers.has(ticker)) {
      // For blacklisted items, require VERY strong evidence
      if (candidate.method !== 'cashtag') {
        // Check contextual rules
        const rules = this.contextualBlacklist.get(ticker);
        if (rules) {
          const meetsRequirements = this.checkContextualRules(messageText, rules);
          if (!meetsRequirements) {
            return null; // Reject
          }
        } else {
          return null; // No cashtag for blacklisted = reject
        }
      }
    }
    
    // Check if already validated
    if (this.validatedTickers.has(ticker)) {
      return {
        ...candidate,
        ticker,
        exchange: this.validatedTickers.get(ticker),
        confidence: Math.max(candidate.baseConfidence, 0.85),
        isValid: true,
        source: 'cached'
      };
    }
    
    // Validate against NEON database
    const dbResult = await this.validateInDatabase(ticker);
    if (!dbResult) {
      return null; // Not a real stock
    }
    
    // Calculate final confidence
    let confidence = candidate.baseConfidence;
    
    // Boost for database match
    confidence = Math.min(confidence + 0.15, 1.0);
    
    // Penalty for blacklisted items that made it through
    if (this.blacklistedTickers.has(ticker)) {
      confidence *= 0.7; // Reduce confidence for blacklisted items
    }
    
    return {
      ...candidate,
      ticker,
      exchange: dbResult.exchange,
      confidence,
      isValid: true,
      source: 'database'
    };
  }

  checkContextualRules(text, rules) {
    const lowerText = text.toLowerCase();
    
    // Check required phrases
    if (rules.requiresPhrases.length > 0) {
      const hasRequired = rules.requiresPhrases.some(phrase => 
        lowerText.includes(phrase.toLowerCase())
      );
      if (!hasRequired) return false;
    }
    
    // Check excluded phrases (if these exist, it's probably not a ticker)
    if (rules.excludesPhrases.length > 0) {
      const hasExcluded = rules.excludesPhrases.some(phrase => 
        new RegExp(`\\b${phrase}\\s+\\w+`, 'i').test(lowerText)
      );
      if (hasExcluded) return false;
    }
    
    return true;
  }

  async validateInDatabase(ticker) {
    try {
      const result = await this.pool.query(`
        SELECT ticker, exchange, security_type, is_active 
        FROM listed_securities 
        WHERE ticker = $1 
        AND exchange IN ('NASDAQ', 'NYSE', 'AMEX')
        AND is_active = true
        LIMIT 1
      `, [ticker]);
      
      return result.rows[0] || null;
    } catch (error) {
      console.error(`Database validation error for ${ticker}:`, error);
      return null;
    }
  }

  async processSingleMessage(messageId, content, authorId, timestamp, authorName = 'Unknown') {
    if (!content || content.length < 2) return [];
    
    // Extract candidates
    const candidates = this.extractCandidates(content);
    if (candidates.length === 0) return [];
    
    const validatedTickers = [];
    
    for (const candidate of candidates) {
      const validated = await this.validateCandidate(
        candidate, 
        content, 
        messageId,
        authorName
      );
      
      if (validated && validated.confidence >= this.thresholds.requireValidation) {
        // Store the detection
        const stored = await this.storeTickerDetection({
          ticker: validated.ticker,
          exchange: validated.exchange,
          source_message_id: messageId,
          message_text: content.substring(0, 500),
          observed_at: timestamp || new Date(),
          author_name: authorName,
          detection_confidence: validated.confidence,
          detection_method: validated.method,
          is_genuine_stock: true
        });
        
        if (stored) {
          validatedTickers.push(validated);
        }
      }
    }
    
    return validatedTickers;
  }

  async storeTickerDetection(detection) {
    try {
      // First, check if this exact message-ticker pair exists
      const existing = await this.pool.query(`
        SELECT id FROM ticker_mentions 
        WHERE ticker = $1 AND message_id = $2
      `, [detection.ticker, detection.source_message_id]);
      
      if (existing.rows.length > 0) {
        return false; // Already processed this mention
      }
      
      // Store the mention
      await this.pool.query(`
        INSERT INTO ticker_mentions (
          ticker, message_id, confidence, detected_at, author_name
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        detection.ticker,
        detection.source_message_id,
        detection.detection_confidence,
        detection.observed_at,
        detection.author_name
      ]);
      
      // Update or insert into stocks table
      await this.pool.query(`
        INSERT INTO stocks (
          ticker, exchange, first_mention_message_id, first_mention_text,
          first_mention_timestamp, first_mention_author, detection_confidence,
          detection_method, is_genuine_stock, mention_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
        ON CONFLICT (ticker) DO UPDATE SET
          mention_count = (
            SELECT COUNT(DISTINCT message_id) 
            FROM ticker_mentions 
            WHERE ticker = $1
          ),
          detection_confidence = GREATEST(stocks.detection_confidence, $7),
          updated_at = CURRENT_TIMESTAMP
      `, [
        detection.ticker,
        detection.exchange,
        detection.source_message_id,
        detection.message_text,
        detection.observed_at,
        detection.author_name,
        detection.detection_confidence,
        detection.detection_method,
        detection.is_genuine_stock
      ]);
      
      return true;
    } catch (error) {
      console.error('Error storing ticker:', error);
      return false;
    }
  }

  async reprocessTodaysMessages(options = {}) {
    const { 
      clearExisting = false,
      batchSize = 50,
      progressCallback = null 
    } = options;
    
    console.log('🔄 Reprocessing today\'s messages...');
    
    if (clearExisting) {
      console.log('⚠️  Clearing existing detections for today...');
      await this.pool.query(`
        DELETE FROM ticker_mentions 
        WHERE detected_at >= CURRENT_DATE
      `);
      await this.pool.query(`
        UPDATE stocks 
        SET mention_count = 0 
        WHERE first_mention_timestamp >= CURRENT_DATE
      `);
    }
    
    // Get today's messages
    const result = await this.pool.query(`
      SELECT id, content, author_id, author_name, timestamp
      FROM discord_messages 
      WHERE timestamp >= CURRENT_DATE
      ORDER BY timestamp ASC
    `);
    
    console.log(`📊 Found ${result.rows.length} messages to process`);
    
    let processed = 0;
    const detections = [];
    
    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize);
      
      for (const message of batch) {
        const tickers = await this.processSingleMessage(
          message.id,
          message.content,
          message.author_id,
          message.timestamp,
          message.author_name
        );
        
        detections.push(...tickers);
        processed++;
        
        if (progressCallback && processed % 100 === 0) {
          progressCallback(processed, result.rows.length);
        }
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✅ Processed ${processed} messages, found ${detections.length} ticker detections`);
    
    // Update mention counts
    await this.updateMentionCounts();
    
    return {
      messagesProcessed: processed,
      tickersDetected: detections.length,
      uniqueTickers: new Set(detections.map(d => d.ticker)).size
    };
  }

  async updateMentionCounts() {
    await this.pool.query(`
      UPDATE stocks s
      SET mention_count = (
        SELECT COUNT(DISTINCT message_id)
        FROM ticker_mentions tm
        WHERE tm.ticker = s.ticker
      ),
      updated_at = CURRENT_TIMESTAMP
    `);
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = TickerExtractorV2;
