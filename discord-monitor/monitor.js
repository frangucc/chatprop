const { Client } = require('discord.js-selfbot-v13');
const { Pool } = require('pg');
const winston = require('winston');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'monitor.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_pM1YgZXw8zim@ep-old-violet-aewo0ts3-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  }
});

// Discord configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TARGET_CHANNELS = process.env.TARGET_CHANNELS ? process.env.TARGET_CHANNELS.split(',') : [
  '438036112007626761' // small-caps channel
];

// Create Discord client
const client = new Client({
  checkUpdate: false
});

// Prepare SQL query for inserting messages
const insertMessageQuery = `INSERT INTO discord_messages (
    id, channel_id, author_id, author_name, author_nickname,
    content, timestamp, timestamp_edited, attachments, embeds, mentions, reactions,
    message_type, is_pinned, author_discriminator, author_is_bot, author_avatar_url,
    guild_id, guild_name, channel_name, channel_category, roles
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
  ON CONFLICT (id) DO UPDATE SET
    content = EXCLUDED.content,
    timestamp_edited = EXCLUDED.timestamp_edited
  RETURNING *`;

// Function to save message to database
async function saveMessage(message) {
  try {
    const attachments = message.attachments.map(a => ({
      name: a.name,
      url: a.url,
      size: a.size
    }));
    const embeds = message.embeds.map(e => e.toJSON());
    const mentions = message.mentions.users.map(u => u.id);
    const roles = message.member?.roles?.cache?.map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor
    })) || [];

    const result = await pool.query(
      insertMessageQuery,
      [
        message.id,                                          // id
        message.channel.id,                                  // channel_id
        message.author.id,                                   // author_id
        message.author.username,                             // author_name
        message.member?.nickname || message.author.username, // author_nickname
        message.content,                                     // content
        message.createdAt,                                   // timestamp
        message.editedAt,                                    // timestamp_edited
        JSON.stringify(attachments),                        // attachments
        JSON.stringify(embeds),                             // embeds
        JSON.stringify(mentions),                           // mentions
        JSON.stringify([]),                                 // reactions
        'DEFAULT',                                          // message_type
        message.pinned || false,                            // is_pinned
        message.author.discriminator || '0',                // author_discriminator
        message.author.bot || false,                        // author_is_bot
        message.author.avatarURL() || null,                 // author_avatar_url
        message.guild?.id || null,                          // guild_id
        message.guild?.name || null,                        // guild_name
        message.channel.name,                               // channel_name
        message.channel.parent?.name || null,               // channel_category
        JSON.stringify(roles)                               // roles
      ]
    );

    logger.info(`Stored message ${message.id} in database`);
    logger.info(`Saved message ${message.id} from ${message.author.username}: ${message.content?.substring(0, 50)}...`);
    
    return true;
  } catch (error) {
    logger.error(`Error saving message ${message.id}:`, error);
    return false;
  }
}

// Discord event handlers
client.on('ready', async () => {
  logger.info(`✅ Discord Monitor started as ${client.user.tag}`);
  logger.info(`📊 Monitoring ${TARGET_CHANNELS.length} channel(s)`);
  
  // Log channel names
  for (const channelId of TARGET_CHANNELS) {
    try {
      const channel = await client.channels.fetch(channelId);
      logger.info(`  - ${channel.name} (${channel.guild?.name})`);
    } catch (err) {
      logger.warn(`  - Channel ${channelId} not accessible`);
    }
  }
});

// Monitor new messages
client.on('messageCreate', async (message) => {
  // Only process messages from target channels
  if (!TARGET_CHANNELS.includes(message.channel.id)) {
    return;
  }
  
  await saveMessage(message);
});

// Monitor message updates
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!TARGET_CHANNELS.includes(newMessage.channel.id)) {
    return;
  }
  
  logger.info(`Message ${newMessage.id} was edited`);
  await saveMessage(newMessage);
});

// Monitor message deletions
client.on('messageDelete', async (message) => {
  if (!TARGET_CHANNELS.includes(message.channel.id)) {
    return;
  }
  
  logger.info(`Message ${message.id} was deleted`);
  // You could mark it as deleted in the database instead of removing
  // await pool.query('UPDATE discord_messages SET deleted = true WHERE id = $1', [message.id]);
});

// Monitor reactions
client.on('messageReactionAdd', async (reaction, user) => {
  if (!TARGET_CHANNELS.includes(reaction.message.channel.id)) {
    return;
  }
  
  logger.info(`${user.username} reacted with ${reaction.emoji.name}`);
  // Update reactions in database
  const message = await reaction.message.fetch();
  const reactions = message.reactions.cache.map(r => ({
    emoji: r.emoji.name,
    count: r.count,
    users: r.users.cache.map(u => u.id)
  }));
  
  await pool.query(
    'UPDATE discord_messages SET reactions = $1 WHERE id = $2',
    [JSON.stringify(reactions), message.id]
  );
});

// Error handling
client.on('error', (error) => {
  logger.error('Discord client error:', error);
});

client.on('warn', (info) => {
  logger.warn('Discord warning:', info);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down Discord Monitor...');
  client.destroy();
  await pool.end();
  process.exit(0);
});

// Health check
setInterval(async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    logger.debug(`Health check OK - DB time: ${result.rows[0].now}`);
  } catch (error) {
    logger.error('Health check failed:', error);
  }
}, 60000); // Every minute

// Start the monitor
logger.info('🚀 Starting Discord Monitor...');
logger.info('⚠️  WARNING: Using user tokens for automation violates Discord ToS');

client.login(DISCORD_TOKEN).catch(error => {
  logger.error('Failed to login:', error);
  process.exit(1);
});
