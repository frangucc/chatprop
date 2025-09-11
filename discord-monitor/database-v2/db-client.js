/**
 * Database Client for V2 Architecture
 * Clean, type-safe database operations
 */

const { Pool } = require('pg');

class DatabaseClient {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  // ============================================
  // MESSAGE OPERATIONS
  // ============================================

  async insertMessage(messageData) {
    const query = `
      INSERT INTO messages (
        id, channel_id, author_id, content,
        discord_timestamp, message_type, is_edited,
        has_attachments, has_embeds
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        is_edited = true,
        edited_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      messageData.id,
      messageData.channelId,
      messageData.authorId,
      messageData.content,
      messageData.timestamp,
      messageData.type || 'DEFAULT',
      messageData.isEdited || false,
      messageData.hasAttachments || false,
      messageData.hasEmbeds || false
    ];
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async getMessagesForProcessing(since, limit = 100) {
    const query = `
      SELECT 
        m.id,
        m.content,
        m.author_id,
        m.channel_id,
        m.discord_timestamp,
        a.username as author_name,
        a.is_trader,
        a.trader_tier
      FROM messages m
      JOIN authors a ON m.author_id = a.id
      WHERE m.discord_timestamp > $1
      AND m.content IS NOT NULL
      AND LENGTH(m.content) > 2
      AND NOT EXISTS (
        SELECT 1 FROM ticker_detections td 
        WHERE td.message_id = m.id
      )
      ORDER BY m.discord_timestamp ASC
      LIMIT $2
    `;
    
    const result = await this.pool.query(query, [since, limit]);
    return result.rows;
  }

  // ============================================
  // AUTHOR OPERATIONS
  // ============================================

  async upsertAuthor(authorData) {
    const query = `
      INSERT INTO authors (
        id, username, discriminator, is_bot, avatar_url
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        last_seen = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      authorData.id,
      authorData.username,
      authorData.discriminator,
      authorData.isBot || false,
      authorData.avatarUrl
    ];
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async markAsTrader(authorId, tier = 'regular') {
    const query = `
      UPDATE authors 
      SET is_trader = true, trader_tier = $2
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [authorId, tier]);
    return result.rows[0];
  }

  // ============================================
  // TICKER OPERATIONS
  // ============================================

  async upsertTicker(tickerData) {
    const query = `
      INSERT INTO tickers (
        symbol, exchange, company_name, security_type, is_active
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (symbol) DO UPDATE SET
        exchange = COALESCE(EXCLUDED.exchange, tickers.exchange),
        company_name = COALESCE(EXCLUDED.company_name, tickers.company_name),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      tickerData.symbol.toUpperCase(),
      tickerData.exchange || 'UNKNOWN',
      tickerData.companyName,
      tickerData.securityType || 'Common',
      tickerData.isActive !== false
    ];
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async insertTickerDetection(detection) {
    const query = `
      INSERT INTO ticker_detections (
        message_id, ticker_symbol, detection_method,
        confidence_score, context_strength, position_in_message,
        detected_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (message_id, ticker_symbol, position_in_message) 
      DO UPDATE SET
        confidence_score = GREATEST(
          ticker_detections.confidence_score, 
          EXCLUDED.confidence_score
        )
      RETURNING *
    `;
    
    const values = [
      detection.messageId,
      detection.ticker.toUpperCase(),
      detection.method,
      detection.confidence,
      detection.contextStrength,
      detection.position || 0,
      detection.detectedText
    ];
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async getTodaysTickers(filters = {}) {
    let query = `
      WITH ticker_stats AS (
        SELECT 
          t.symbol,
          t.exchange,
          t.company_name,
          t.market_cap_tier,
          COUNT(DISTINCT td.message_id) as mention_count,
          COUNT(DISTINCT m.author_id) as unique_authors,
          AVG(td.confidence_score)::numeric(3,2) as avg_confidence,
          MAX(td.confidence_score) as max_confidence,
          MIN(m.discord_timestamp) as first_mention,
          MAX(m.discord_timestamp) as last_mention,
          ARRAY_AGG(DISTINCT td.detection_method) as methods,
          ARRAY_AGG(DISTINCT a.username) FILTER (WHERE a.is_trader = true) as trader_mentions
        FROM tickers t
        JOIN ticker_detections td ON t.symbol = td.ticker_symbol
        JOIN messages m ON td.message_id = m.id
        JOIN authors a ON m.author_id = a.id
        WHERE DATE(m.discord_timestamp) = CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM ticker_blacklist bl 
          WHERE bl.ticker = t.symbol
          AND bl.is_permanent = true
        )
    `;
    
    const conditions = [];
    const params = [];
    let paramCount = 0;
    
    if (filters.minConfidence) {
      conditions.push(`td.confidence_score >= $${++paramCount}`);
      params.push(filters.minConfidence);
    }
    
    if (filters.traders && filters.traders.length > 0) {
      conditions.push(`a.username = ANY($${++paramCount}::text[])`);
      params.push(filters.traders);
    }
    
    if (filters.exchange) {
      conditions.push(`t.exchange = $${++paramCount}`);
      params.push(filters.exchange);
    }
    
    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }
    
    query += `
        GROUP BY t.symbol, t.exchange, t.company_name, t.market_cap_tier
      )
      SELECT * FROM ticker_stats
      ORDER BY mention_count DESC, max_confidence DESC
      LIMIT 100
    `;
    
    const result = await this.pool.query(query, params);
    return result.rows;
  }

  // ============================================
  // BLACKLIST OPERATIONS
  // ============================================

  async addToBlacklist(ticker, reason, options = {}) {
    const query = `
      INSERT INTO ticker_blacklist (
        ticker, reason, category, min_confidence_required,
        requires_cashtag, requires_price_context, is_permanent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (ticker) DO UPDATE SET
        reason = EXCLUDED.reason,
        category = EXCLUDED.category,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      ticker.toUpperCase(),
      reason,
      options.category || 'other',
      options.minConfidence || 0.90,
      options.requiresCashtag || false,
      options.requiresPriceContext || false,
      options.isPermanent || false
    ];
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  async getBlacklist() {
    const query = `
      SELECT 
        b.*,
        ARRAY_AGG(
          CASE WHEN bp.pattern_type = 'required' 
          THEN bp.pattern END
        ) FILTER (WHERE bp.pattern_type = 'required') as required_patterns,
        ARRAY_AGG(
          CASE WHEN bp.pattern_type = 'excluded' 
          THEN bp.pattern END
        ) FILTER (WHERE bp.pattern_type = 'excluded') as excluded_patterns
      FROM ticker_blacklist b
      LEFT JOIN blacklist_patterns bp ON b.ticker = bp.ticker
      GROUP BY b.ticker, b.reason, b.category, b.min_confidence_required,
               b.requires_cashtag, b.requires_price_context, 
               b.is_permanent, b.added_by, b.created_at, b.updated_at
      ORDER BY b.ticker
    `;
    
    const result = await this.pool.query(query);
    return result.rows;
  }

  async checkBlacklist(ticker) {
    const query = `
      SELECT * FROM ticker_blacklist 
      WHERE ticker = $1
    `;
    
    const result = await this.pool.query(query, [ticker.toUpperCase()]);
    return result.rows[0];
  }

  // ============================================
  // VALIDATION OPERATIONS
  // ============================================

  async recordValidation(ticker, source, isValid, confidence, reasoning) {
    const query = `
      INSERT INTO ticker_validations (
        ticker_symbol, validation_source, is_valid,
        confidence, reasoning
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    const values = [
      ticker.toUpperCase(),
      source,
      isValid,
      confidence,
      reasoning
    ];
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  // ============================================
  // STATS OPERATIONS
  // ============================================

  async updateDailyStats(date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const query = 'SELECT update_daily_ticker_stats($1::date)';
    await this.pool.query(query, [targetDate]);
  }

  async getDailyStats(date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const query = `
      SELECT * FROM ticker_daily_stats
      WHERE stat_date = $1
      ORDER BY mention_count DESC
    `;
    
    const result = await this.pool.query(query, [targetDate]);
    return result.rows;
  }

  // ============================================
  // PROCESSING STATE
  // ============================================

  async updateProcessingState(id, state) {
    const query = `
      INSERT INTO processing_state (
        id, last_processed_message_id, last_processed_timestamp,
        messages_processed, tickers_detected, errors_count
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        last_processed_message_id = EXCLUDED.last_processed_message_id,
        last_processed_timestamp = EXCLUDED.last_processed_timestamp,
        messages_processed = processing_state.messages_processed + EXCLUDED.messages_processed,
        tickers_detected = processing_state.tickers_detected + EXCLUDED.tickers_detected,
        errors_count = processing_state.errors_count + EXCLUDED.errors_count,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      id,
      state.lastMessageId,
      state.lastTimestamp,
      state.messagesProcessed || 0,
      state.tickersDetected || 0,
      state.errors || 0
    ];
    
    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  // ============================================
  // UTILITY
  // ============================================

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = DatabaseClient;
