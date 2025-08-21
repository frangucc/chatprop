#!/usr/bin/env node

// Backfill ticker detections for today's messages in v2 schema
// Uses TickerExtractor (v2-aware) and DATABASE2_URL
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const TickerExtractor = require('./lib/ticker-extractor');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE2_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const extractor = new TickerExtractor(
    process.env.DATABASE2_URL || process.env.DATABASE_URL,
    process.env.ANTHROPIC_API_KEY
  );

  try {
    console.log('🚀 Backfill v2: processing today\'s messages (CST day start)');
    await extractor.initialize();

    // Start of day in Chicago time
    const query = `
      SELECT m.id AS message_id,
             m.content,
             m.author_id,
             a.username AS author_name,
             m.discord_timestamp AS ts
      FROM messages m
      JOIN authors a ON m.author_id = a.id
      WHERE m.discord_timestamp >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago')
      ORDER BY ts ASC
    `;

    const { rows } = await pool.query(query);
    console.log(`📝 Found ${rows.length} messages to process`);

    let processed = 0;
    let detections = 0;

    for (const msg of rows) {
      try {
        const result = await extractor.processSingleMessage(
          msg.message_id,
          msg.content || '',
          msg.author_name || msg.author_id,
          msg.ts
        );
        detections += (result?.length || 0);
        processed++;
        if (processed % 50 === 0) {
          console.log(`… progress ${processed}/${rows.length}, detections: ${detections}`);
        }
      } catch (e) {
        console.error(`❌ Error on message ${msg.message_id}:`, e.message);
      }
    }

    console.log(`✅ Done. Messages processed: ${processed}. Detections inserted: ${detections}.`);
  } finally {
    await extractor.close?.();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('💥 Backfill failed:', e);
    process.exit(1);
  });
}
