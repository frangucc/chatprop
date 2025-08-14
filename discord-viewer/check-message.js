require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkMessage() {
  try {
    const result = await pool.query(
      'SELECT message_id, timestamp, content, author_name FROM discord_messages WHERE message_id = $1',
      ['1405425727394025502']
    );
    
    if (result.rows.length > 0) {
      const msg = result.rows[0];
      const date = new Date(msg.timestamp);
      
      console.log('Message ID:', msg.message_id);
      console.log('Timestamp in DB:', msg.timestamp);
      console.log('UTC Time:', date.toISOString());
      console.log('CST Time:', date.toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }));
      console.log('Author:', msg.author_name);
      console.log('Content preview:', msg.content?.substring(0, 100));
    } else {
      console.log('Message with ID 1405425727394025502 not found in database');
    }
    
    // Also check what messages we have from today
    console.log('\n--- Checking today\'s messages ---');
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0); // Local midnight
    
    const todayMessages = await pool.query(
      'SELECT COUNT(*) as count, MIN(timestamp) as earliest, MAX(timestamp) as latest FROM discord_messages WHERE timestamp >= $1',
      [todayStart.toISOString()]
    );
    
    console.log('Messages from today (after midnight):', todayMessages.rows[0].count);
    if (todayMessages.rows[0].count > 0) {
      console.log('Earliest today:', new Date(todayMessages.rows[0].earliest).toLocaleString('en-US', {timeZone: 'America/Chicago'}));
      console.log('Latest today:', new Date(todayMessages.rows[0].latest).toLocaleString('en-US', {timeZone: 'America/Chicago'}));
    }
    
    pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    pool.end();
  }
}

checkMessage();
