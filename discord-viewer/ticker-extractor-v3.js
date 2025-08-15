/**
 * Ticker Extractor V3 - Clean Architecture Edition
 * Works with the new normalized database schema
 */

const DatabaseClient = require('./database-v2/db-client');
const Anthropic = require('@anthropic-ai/sdk');

class TickerExtractorV3 {
  constructor(databaseUrl, anthropicKey) {
    this.db = new DatabaseClient(databaseUrl);
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
    
    // More inclusive extraction patterns
    this.patterns = {
      cashtag: /\$([A-Z]{1,5})\b/g,
      allCaps: /\b([A-Z]{2,5})\b/g,  // Any all-caps word 2-5 chars
      priceTarget: /\b([A-Z]{2,5})\s+(?:PT|price target|target)[\s:]+\$?[\d.]+/gi
    };
    
    // Load blacklist on init
    this.blacklist = new Map();
    this.blacklistPatterns = new Map();
  }

  async initialize() {
    // Load blacklist from database
    const blacklistData = await this.db.getBlacklist();
    
    for (const entry of blacklistData) {
      this.blacklist.set(entry.ticker, {
        minConfidence: entry.min_confidence_required,
        requiresCashtag: entry.requires_cashtag,
        requiresPriceContext: entry.requires_price_context,
        isPermanent: entry.is_permanent
      });
      
      if (entry.required_patterns || entry.excluded_patterns) {
        this.blacklistPatterns.set(entry.ticker, {
          required: entry.required_patterns || [],
          excluded: entry.excluded_patterns || []
        });
      }
    }
    
    console.log(`✅ Loaded ${this.blacklist.size} blacklist entries`);
  }

  async processMessage(messageData) {
    const { id, content, author_id, discord_timestamp, author_name } = messageData;
    
    if (!content || content.length < 3) return [];
    
    // Extract candidates
    const candidates = this.extractCandidates(content);
    const detections = [];
    
    for (const [ticker, candidate] of candidates) {
      // Check blacklist
      const blacklistEntry = this.blacklist.get(ticker);
      
      if (blacklistEntry) {
        // Check if permanently blacklisted
        if (blacklistEntry.isPermanent) continue;
        
        // Check context requirements
        if (blacklistEntry.requiresCashtag && candidate.method !== 'cashtag') continue;
        
        // Check pattern requirements
        if (!this.checkBlacklistPatterns(ticker, content)) continue;
        
        // Require higher confidence
        if (candidate.confidence < blacklistEntry.minConfidence) continue;
      }
      
      // Ensure ticker exists in database
      await this.db.upsertTicker({
        symbol: ticker,
        exchange: 'UNKNOWN' // Will be updated by enrichment job
      });
      
      // Store detection
      const detection = await this.db.insertTickerDetection({
        messageId: id,
        ticker: ticker,
        method: candidate.method,
        confidence: candidate.confidence,
        contextStrength: candidate.contextStrength,
        position: candidate.position,
        detectedText: candidate.original
      });
      
      if (detection) {
        detections.push(detection);
      }
    }
    
    return detections;
  }

  extractCandidates(text) {
    const candidates = new Map();
    
    // 1. Cashtags (highest confidence)
    const cashtags = [...text.matchAll(this.patterns.cashtag)];
    for (const match of cashtags) {
      const ticker = match[1].toUpperCase();
      if (ticker.length >= 1 && ticker.length <= 5) {
        candidates.set(ticker, {
          ticker,
          method: 'cashtag',
          original: match[0],
          confidence: 0.95,
          contextStrength: 1.0,
          position: match.index
        });
      }
    }
    
    // 2. All-caps words (medium confidence)
    const allCaps = [...text.matchAll(this.patterns.allCaps)];
    for (const match of allCaps) {
      const ticker = match[1].toUpperCase();
      
      // Skip if already found as cashtag
      if (candidates.has(ticker)) continue;
      
      // Skip common words unless they have some context
      if (this.isCommonWord(ticker)) {
        // Check if there's any trading context at all
        const hasAnyContext = this.hasAnyTradingContext(text) || 
                            this.hasVeryStrongContext(text, ticker);
        if (!hasAnyContext) continue;
      }
      
      // Calculate confidence based on context
      const hasStrongContext = this.hasStrongTradingContext(text);
      const confidence = hasStrongContext ? 0.85 : 0.70;
      
      candidates.set(ticker, {
        ticker,
        method: 'contextual',
        original: match[0],
        confidence: confidence,
        contextStrength: hasStrongContext ? 0.8 : 0.5,
        position: match.index
      });
    }
    
    // 3. Price targets (high confidence)
    const priceTargets = [...text.matchAll(this.patterns.priceTarget)];
    for (const match of priceTargets) {
      const ticker = match[1].toUpperCase();
      if (!candidates.has(ticker)) {
        candidates.set(ticker, {
          ticker,
          method: 'price_target',
          original: match[0],
          confidence: 0.85,
          contextStrength: 0.9,
          position: match.index
        });
      }
    }
    
    return candidates;
  }

  hasAnyTradingContext(text) {
    const contextTerms = [
      'grab', 'grabbed', 'loading', 'loaded', 'adding', 'added',
      'stop', 'stopped', 'flush', 'ramping', 'moving', 'dip',
      'break', 'breakout', 'lining up', 'wants it', 'lets go',
      'shaved', 'trailing', 'entry', 'exit', 'target', 'PT'
    ];
    
    const lowerText = text.toLowerCase();
    return contextTerms.some(term => lowerText.includes(term));
  }

  hasStrongTradingContext(text) {
    const tradingTerms = [
      'shares', 'calls', 'puts', 'position', 'buying', 'selling',
      'bullish', 'bearish', 'target', 'PT', 'entry', 'exit',
      'volume', 'breakout', 'support', 'resistance'
    ];
    
    const lowerText = text.toLowerCase();
    return tradingTerms.some(term => lowerText.includes(term));
  }

  hasVeryStrongContext(text, ticker) {
    const veryStrongIndicators = [
      `$${ticker}`,
      `${ticker} shares`,
      `${ticker} calls`,
      `${ticker} puts`,
      `buying ${ticker}`,
      `selling ${ticker}`,
      `${ticker} PT`,
      `${ticker} price target`
    ];
    
    return veryStrongIndicators.some(indicator => 
      text.includes(indicator) || text.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  isCommonWord(ticker) {
    const commonWords = new Set([
      // Basic English words
      'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL',
      'CAN', 'HAS', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY',
      'GET', 'GOT', 'HIM', 'HIS', 'HOW', 'ITS', 'LET', 'MAY',
      'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY',
      'DID', 'CAR', 'EAT', 'END', 'FAR', 'FUN', 'GOT', 'HOT',
      'ITS', 'LET', 'NEW', 'NOW', 'OLD', 'RUN', 'SIT', 'TOP',
      'TRY', 'USE', 'BIG', 'GO', 'IF', 'IN', 'IS', 'IT', 'ME',
      'MY', 'NO', 'OF', 'ON', 'OR', 'SO', 'TO', 'UP', 'WE',
      // Additional common words from your data
      'HOLD', 'JUST', 'NEEDS', 'SMALL', 'MOVE', 'TAKE', 'MAKE',
      'CALL', 'PUT', 'COME', 'LOOK', 'WANT', 'GIVE', 'USED',
      'FIND', 'TELL', 'NEXT', 'FEW', 'SAME', 'STILL', 'BEING',
      'OVER', 'AFTER', 'ONLY', 'ROUND', 'YEAR', 'WORK', 'BACK',
      'CALLS', 'PUTS', 'DOWN', 'ABOUT', 'THERE', 'THINK', 'WHICH',
      'WHEN', 'THEM', 'SOME', 'TIME', 'VERY', 'JUST', 'KNOW',
      'TAKE', 'THAN', 'LIKE', 'INTO', 'COULD', 'STATE', 'ONLY',
      'YEAR', 'HAVE', 'WILL', 'EVEN', 'WHAT', 'FROM', 'BEEN',
      // Common false positives
      'WOW', 'FUCK', 'SHIT', 'DAMN', 'HELL', 'NICE', 'GOOD',
      'GREAT', 'FLUSH', 'GREEN', 'RED', 'ONTO', 'PH', 'LOL',
      'OMG', 'WTF', 'BRB', 'BTW', 'IMO', 'IMHO', 'IDK', 'FYI',
      'ASAP', 'FAQ', 'DIY', 'ETA', 'NA', 'OK', 'OKAY', 'YES',
      'NO', 'MAYBE', 'SURE', 'YEAH', 'NAH', 'YEP', 'NOPE'
    ]);
    
    return commonWords.has(ticker);
  }

  checkBlacklistPatterns(ticker, text) {
    const patterns = this.blacklistPatterns.get(ticker);
    if (!patterns) return true;
    
    const lowerText = text.toLowerCase();
    
    // Check excluded patterns (if any match, reject)
    if (patterns.excluded && patterns.excluded.length > 0) {
      for (const pattern of patterns.excluded) {
        if (lowerText.includes(pattern.toLowerCase())) {
          return false; // Excluded pattern found
        }
      }
    }
    
    // Check required patterns (at least one must match)
    if (patterns.required && patterns.required.length > 0) {
      for (const pattern of patterns.required) {
        if (lowerText.includes(pattern.toLowerCase()) || 
            text.includes(pattern)) { // Check both cases for things like $TICKER
          return true; // Required pattern found
        }
      }
      return false; // No required patterns found
    }
    
    return true;
  }

  async validateWithAI(ticker, context) {
    if (!this.anthropic) return null;
    
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',  // Latest Claude 3.5 Sonnet
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Is "${ticker}" being used as a stock ticker in this context? Context: "${context}". Answer with just YES or NO.`
        }]
      });
      
      const answer = response.content[0].text.trim().toUpperCase();
      return answer === 'YES';
    } catch (error) {
      console.error('AI validation error:', error);
      return null;
    }
  }

  async processBatch(messages, options = {}) {
    const { onProgress, batchSize = 50 } = options;
    const results = [];
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      
      // Process in transaction for consistency
      await this.db.transaction(async (client) => {
        for (const message of batch) {
          const detections = await this.processMessage(message);
          results.push(...detections);
        }
      });
      
      if (onProgress) {
        onProgress({
          processed: i + batch.length,
          total: messages.length,
          percentage: Math.round((i + batch.length) / messages.length * 100)
        });
      }
    }
    
    // Update daily stats
    await this.db.updateDailyStats();
    
    return results;
  }

  async getStats() {
    const todayStats = await this.db.getDailyStats();
    const tickers = await this.db.getTodaysTickers({ minConfidence: 0.7 });
    
    return {
      uniqueTickers: tickers.length,
      totalMentions: todayStats.reduce((sum, stat) => sum + stat.mention_count, 0),
      topTickers: tickers.slice(0, 10),
      stats: todayStats
    };
  }

  async close() {
    await this.db.close();
  }
}

module.exports = TickerExtractorV3;
