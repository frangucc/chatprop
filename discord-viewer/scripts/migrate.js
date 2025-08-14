const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Parse the connection string from .env
const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_pM1YgZXw8zim@ep-old-violet-aewo0ts3-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

async function migrate() {
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('Connecting to database...');
    await client.connect();

    // Read the schema file and create tables
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schema);
    console.log('Schema created successfully');

    // Read the Discord JSON export
    const jsonPath = path.join(__dirname, '../../exports/Noremac Newell Trading - 🔔 Trading Floor 🔔 - ︱small-caps [438036112007626761] (after 2025-08-13).json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    console.log(`Found ${data.messages.length} messages to import`);

    // Prepare the insert statement
    const insertQuery = `
      INSERT INTO discord_messages (
        id, message_type, content, timestamp, timestamp_edited, is_pinned,
        author_id, author_name, author_nickname, author_discriminator, 
        author_is_bot, author_avatar_url,
        guild_id, guild_name, channel_id, channel_name, channel_category,
        attachments, embeds, reactions, mentions, roles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        timestamp_edited = EXCLUDED.timestamp_edited,
        reactions = EXCLUDED.reactions
    `;

    // Process messages in batches
    const batchSize = 100;
    for (let i = 0; i < data.messages.length; i += batchSize) {
      const batch = data.messages.slice(i, i + batchSize);
      
      for (const msg of batch) {
        try {
          await client.query(insertQuery, [
            msg.id,
            msg.type,
            msg.content,
            msg.timestamp,
            msg.timestampEdited,
            msg.isPinned,
            msg.author.id,
            msg.author.name,
            msg.author.nickname,
            msg.author.discriminator,
            msg.author.isBot,
            msg.author.avatarUrl,
            data.guild.id,
            data.guild.name,
            data.channel.id,
            data.channel.name,
            data.channel.category,
            JSON.stringify(msg.attachments),
            JSON.stringify(msg.embeds),
            JSON.stringify(msg.reactions),
            JSON.stringify(msg.mentions),
            JSON.stringify(msg.author.roles)
          ]);
        } catch (err) {
          console.error(`Error inserting message ${msg.id}:`, err.message);
        }
      }
      
      console.log(`Processed ${Math.min(i + batchSize, data.messages.length)} / ${data.messages.length} messages`);
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

// Run migration
migrate();
