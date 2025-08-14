const { Client } = require('discord.js-selfbot-v13');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_pM1YgZXw8zim@ep-old-violet-aewo0ts3-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

const client = new Client({ checkUpdate: false });
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TARGET_CHANNELS = process.env.TARGET_CHANNELS ? process.env.TARGET_CHANNELS.split(',') : ['438036112007626761'];

async function backfillChannel(channelId, days = 1) {
  console.log(`\n📥 Backfilling channel ${channelId} for last ${days} days...`);
  
  try {
    const channel = await client.channels.fetch(channelId);
    console.log(`  Channel: ${channel.name} in ${channel.guild?.name}`);
    
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    let lastId = null;
    let totalMessages = 0;
    let batchCount = 0;
    
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      
      const messages = await channel.messages.fetch(options);
      if (messages.size === 0) break;
      
      const oldestMessage = messages.last();
      if (new Date(oldestMessage.createdTimestamp) < since) {
        console.log(`  Reached target date, stopping backfill`);
        break;
      }
      
      // Process messages in batch
      const values = [];
      const params = [];
      let paramIndex = 1;
      
      for (const [id, message] of messages) {
        const author = message.author;
        const member = message.member;
        const guild = message.guild;
        
        values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 
          $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
          $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
          $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        
        params.push(
          message.id,
          message.type || 'DEFAULT',
          message.content,
          message.createdAt.toISOString(),
          message.editedAt ? message.editedAt.toISOString() : null,
          message.pinned,
          author.id,
          author.username,
          member?.nickname || null,
          author.discriminator,
          author.bot,
          author.avatarURL(),
          guild?.id || null,
          guild?.name || null,
          channel.id,
          channel.name,
          channel.parent?.name || null,
          JSON.stringify(message.attachments.map(a => ({
            name: a.name,
            url: a.url,
            size: a.size
          }))),
          JSON.stringify(message.embeds.map(e => e.toJSON())),
          JSON.stringify(message.reactions.cache.map(r => ({
            emoji: r.emoji.name,
            count: r.count
          }))),
          JSON.stringify(message.mentions.users.map(u => u.id)),
          JSON.stringify(member?.roles?.cache?.map(r => ({
            id: r.id,
            name: r.name,
            color: r.hexColor
          })) || [])
        );
      }
      
      if (values.length > 0) {
        const insertQuery = `
          INSERT INTO discord_messages (
            id, message_type, content, timestamp, timestamp_edited, is_pinned,
            author_id, author_name, author_nickname, author_discriminator, 
            author_is_bot, author_avatar_url,
            guild_id, guild_name, channel_id, channel_name, channel_category,
            attachments, embeds, reactions, mentions, roles
          ) VALUES ${values.join(', ')}
          ON CONFLICT (id) DO NOTHING
        `;
        
        await pool.query(insertQuery, params);
        batchCount++;
        totalMessages += messages.size;
        console.log(`  Batch ${batchCount}: Imported ${messages.size} messages (Total: ${totalMessages})`);
      }
      
      lastId = messages.last().id;
      
      // Rate limit protection
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`✅ Channel backfill complete: ${totalMessages} messages imported`);
    return totalMessages;
    
  } catch (error) {
    console.error(`❌ Error backfilling channel ${channelId}:`, error.message);
    return 0;
  }
}

async function main() {
  console.log('🚀 Discord Backfill Tool');
  console.log('⚠️  WARNING: Using user tokens violates Discord ToS\n');
  
  await client.login(DISCORD_TOKEN);
  console.log(`✅ Logged in as ${client.user.tag}\n`);
  
  const args = process.argv.slice(2);
  const days = parseInt(args[0]) || 1;
  
  let totalMessages = 0;
  for (const channelId of TARGET_CHANNELS) {
    totalMessages += await backfillChannel(channelId, days);
  }
  
  console.log(`\n📊 Backfill Summary:`);
  console.log(`  Total messages imported: ${totalMessages}`);
  console.log(`  Channels processed: ${TARGET_CHANNELS.length}`);
  
  client.destroy();
  await pool.end();
  process.exit(0);
}

main().catch(console.error);
