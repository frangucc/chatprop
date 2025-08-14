#!/usr/bin/env node

// Debug ticker extraction step by step
const TickerExtractor = require('./lib/ticker-extractor');
require('dotenv').config({ path: '.env.local' });

async function debugExtraction() {
  const extractor = new TickerExtractor(
    process.env.DATABASE_URL,
    process.env.ANTHROPIC_API_KEY
  );

  try {
    // Test messages that should contain tickers
    const testMessages = [
      "Holy TRIB",
      "New HOD on **$CGTX**, WW", 
      "IVP ww",
      "yes, AERT flying now",
      "XPON ww here for next leg up 👀",
      "**$SLDP**, pennant setting up now, WW"
    ];

    for (const message of testMessages) {
      console.log(`\n🔍 Debugging: "${message}"`);
      
      // Step 1: Test basic regex extraction
      const basicPattern = /\b[A-Z]{3,5}\b/g;
      const basicMatches = message.match(basicPattern);
      console.log(`  Basic regex matches: ${basicMatches ? basicMatches.join(', ') : 'none'}`);
      
      // Step 2: Test cashtag extraction
      const cashtagPattern = /\$([A-Z]{1,5})\b/g;
      const cashtagMatches = [...message.matchAll(cashtagPattern)].map(m => m[1]);
      console.log(`  Cashtag matches: ${cashtagMatches.length > 0 ? cashtagMatches.join(', ') : 'none'}`);
      
      // Step 3: Test the actual extractor method
      try {
        const results = await extractor.processSingleMessage(
          'debug_' + Date.now(),
          message,
          'debug_author',
          new Date().toISOString()
        );
        
        console.log(`  Extractor results: ${results.length > 0 ? results.map(r => r.ticker).join(', ') : 'none'}`);
        
        if (results.length === 0 && (basicMatches || cashtagMatches.length > 0)) {
          console.log(`  ⚠️  Potential issue: regex found matches but extractor didn't`);
        }
      } catch (error) {
        console.log(`  ❌ Extractor error: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Debug error:', error);
  } finally {
    await extractor.close();
  }
}

debugExtraction();
