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
  connectionString: process.env.DATABASE2_URL || 'postgresql://neondb_owner:npg_Z7txvpsw2TIG@ep-dawn-bird-aeah6d7i-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
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

// Prepare SQL query for inserting messages (v2 schema)
const insertMessageQuery = `INSERT INTO messages (
    id, channel_id, author_id, content, message_type,
    is_edited, is_pinned, has_attachments, has_embeds, discord_timestamp
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (id) DO UPDATE SET
    content = EXCLUDED.content,
    is_edited = true,
    edited_at = CURRENT_TIMESTAMP
  RETURNING *`;

// Function to save message to database
async function saveMessage(message) {
  try {
    // First ensure author exists
    await pool.query(
      `INSERT INTO authors (id, username, discriminator, is_bot, avatar_url) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (id) DO UPDATE SET 
         username = EXCLUDED.username,
         avatar_url = EXCLUDED.avatar_url`,
      [
        message.author.id,
        message.author.username,
        message.author.discriminator || '0',
        message.author.bot || false,
        message.author.avatarURL() || null
      ]
    );

    // Then insert the message (v2 schema)
    const result = await pool.query(
      insertMessageQuery,
      [
        message.id,                                          // id
        message.channel.id,                                  // channel_id
        message.author.id,                                   // author_id
        message.content,                                     // content
        'DEFAULT',                                          // message_type
        message.editedAt !== null,                          // is_edited
        message.pinned || false,                            // is_pinned
        message.attachments.size > 0,                       // has_attachments
        message.embeds.length > 0,                          // has_embeds
        message.createdAt                                   // discord_timestamp
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
  
  // For v2 schema, store reactions in separate table
  await pool.query(
    `INSERT INTO message_reactions (message_id, user_id, emoji_name, created_at) 
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
     ON CONFLICT (message_id, user_id, emoji_name) DO NOTHING`,
    [message.id, user.id, reaction.emoji.name]
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
