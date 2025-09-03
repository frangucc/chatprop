/**
 * Price Extractor - Extract price mentions from Discord messages
 * Handles various price formats including markdown formatting
 */

class PriceExtractor {
  constructor() {
    // Price patterns - ordered by specificity (most specific first)
    this.pricePatterns = [
      // $12.34 format (with or without markdown)
      /\*{0,2}`{0,1}\${0,1}\*{0,2}`{0,1}(\d{1,4}(?:\.\d{1,4})?)\*{0,2}`{0,1}\${0,1}\*{0,2}`{0,1}/g,
      
      // Standard $12.34 format
      /\$(\d{1,4}(?:\.\d{1,4})?)\b/g,
      
      // Decimal without $ when near ticker context
      /\b(\d{1,4}\.\d{1,4})\b/g,
      
      // Whole numbers when in price context
      /\b(\d{1,4})\b(?=\s*(?:PT|price target|target|resistance|support))/gi
    ];
    
    // Price context indicators
    this.priceContexts = [
      'PT', 'price target', 'target', 'resistance', 'support', 'entry', 'exit',
      'buy', 'sell', 'stop', 'level', 'break', 'hold', 'above', 'below',
      'hit', 'bounce', 'reject', 'test', 'watch', 'key level'
    ];
  }

  /**
   * Extract the first price mentioned in a message
   * @param {string} content - Message content
   * @param {string} ticker - Ticker symbol to provide context
   * @returns {number|null} - First price found or null
   */
  extractFirstPrice(content, ticker = '') {
    if (!content || typeof content !== 'string') return null;
    
    // Clean content for better matching
    const cleanContent = content.trim();
    
    // Try each pattern in order of specificity
    for (const pattern of this.pricePatterns) {
      pattern.lastIndex = 0; // Reset regex
      const matches = [...cleanContent.matchAll(pattern)];
      
      for (const match of matches) {
        const priceStr = match[1];
        const price = parseFloat(priceStr);
        
        // Validate price range (reasonable stock prices)
        if (price > 0 && price <= 10000) {
          // For decimal patterns, ensure it's in price context
          if (pattern === this.pricePatterns[2] || pattern === this.pricePatterns[3]) {
            if (this.hasNearbyPriceContext(cleanContent, match.index, ticker)) {
              return price;
            }
          } else {
            return price;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Check if there's price context near the matched position
   * @param {string} content - Full message content
   * @param {number} matchIndex - Position of the price match
   * @param {string} ticker - Ticker symbol
   * @returns {boolean}
   */
  hasNearbyPriceContext(content, matchIndex, ticker) {
    // Check 50 characters before and after the match
    const contextStart = Math.max(0, matchIndex - 50);
    const contextEnd = Math.min(content.length, matchIndex + 50);
    const context = content.slice(contextStart, contextEnd).toLowerCase();
    
    // Check for ticker mention nearby
    if (ticker && context.includes(ticker.toLowerCase())) {
      return true;
    }
    
    // Check for price context words
    return this.priceContexts.some(contextWord => 
      context.includes(contextWord.toLowerCase())
    );
  }

  /**
   * Extract all prices from a message with their positions
   * @param {string} content - Message content
   * @returns {Array} - Array of {price, position, context}
   */
  extractAllPrices(content) {
    if (!content || typeof content !== 'string') return [];
    
    const prices = [];
    const cleanContent = content.trim();
    
    for (const pattern of this.pricePatterns) {
      pattern.lastIndex = 0;
      let match;
      
      while ((match = pattern.exec(cleanContent)) !== null) {
        const price = parseFloat(match[1]);
        
        if (price > 0 && price <= 10000) {
          prices.push({
            price,
            position: match.index,
            rawMatch: match[0],
            context: this.getContextAround(cleanContent, match.index)
          });
        }
      }
    }
    
    // Sort by position and remove duplicates
    return prices
      .sort((a, b) => a.position - b.position)
      .filter((price, index, arr) => 
        index === 0 || Math.abs(price.price - arr[index - 1].price) > 0.01
      );
  }

  /**
   * Get context around a price mention
   * @param {string} content - Full content
   * @param {number} position - Position of price
   * @returns {string}
   */
  getContextAround(content, position) {
    const start = Math.max(0, position - 30);
    const end = Math.min(content.length, position + 30);
    return content.slice(start, end).trim();
  }
}

module.exports = PriceExtractor;
