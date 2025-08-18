const { Client } = require('pg');
require('dotenv').config();

async function checkTimestamps() {
  console.log('DATABASE2_URL:', process.env.DATABASE2_URL ? 'Set' : 'Not set');
  
  if (!process.env.DATABASE2_URL) {
    console.error('DATABASE2_URL not found in environment');
    return;
  }
  
  const client = new Client({
    connectionString: process.env.DATABASE2_URL
  });

  try {
    await client.connect();
    
    // First list all tables
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('Tables in database:');
    tables.rows.forEach(row => console.log('  -', row.table_name));
    
    // Check messages table for BMRA mentions
    const result = await client.query(`
      SELECT m.id, m.timestamp, m.content, a.nickname, a.username
      FROM messages m
      JOIN authors a ON m.author_id = a.id
      WHERE m.content ILIKE '%BMRA%'
      ORDER BY m.timestamp DESC
      LIMIT 5
    `);
    
    console.log('BMRA mentions in database:');
    result.rows.forEach(row => {
      const date = new Date(row.timestamp);
      console.log(`\nID: ${row.id}`);
      console.log(`Raw timestamp: ${row.timestamp}`);
      console.log(`As Date: ${date.toISOString()}`);
      console.log(`Local time: ${date.toLocaleString()}`);
      console.log(`Author: ${row.author_name}`);
      console.log(`Content: ${row.content?.substring(0, 50)}...`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkTimestamps();
