const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function setup() {
  console.log('🚀 Discord Monitor Setup\n');
  console.log('⚠️  WARNING: Using user tokens violates Discord ToS. Use at your own risk.\n');
  
  // Check for existing .env
  const envPath = path.join(__dirname, '../.env');
  let config = {};
  
  if (fs.existsSync(envPath)) {
    console.log('✅ Found existing .env file');
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        config[key.trim()] = value.trim();
      }
    });
  }
  
  // Get Discord token
  if (config.DISCORD_TOKEN) {
    console.log('✅ Discord token found in .env');
  } else {
    console.log('\n❌ Discord token not found');
    console.log('To get your token:');
    console.log('1. Open Discord in browser');
    console.log('2. Press F12 to open Developer Tools');
    console.log('3. Go to Network tab');
    console.log('4. Type /api in filter box');
    console.log('5. Send any message in Discord');
    console.log('6. Click on any request to /api');
    console.log('7. In Headers, find "authorization:" and copy the value\n');
    
    const token = await question('Enter your Discord token: ');
    config.DISCORD_TOKEN = token;
  }
  
  // Get target channels
  console.log('\nTarget channels (comma-separated IDs):');
  console.log('Current: 438036112007626761 (small-caps)');
  const channels = await question('Enter channel IDs (or press Enter for default): ');
  if (channels) {
    config.TARGET_CHANNELS = channels;
  } else {
    config.TARGET_CHANNELS = '438036112007626761';
  }
  
  // Save configuration
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  fs.writeFileSync(envPath, envContent);
  console.log('\n✅ Configuration saved to .env');
  
  // Test database connection
  console.log('\n🔄 Testing database connection...');
  const pool = new Pool({
    connectionString: config.DATABASE_URL || 'postgresql://neondb_owner:npg_pM1YgZXw8zim@ep-old-violet-aewo0ts3-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');
    console.log(`   Server time: ${result.rows[0].now}`);
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
  } finally {
    await pool.end();
  }
  
  console.log('\n📋 Setup complete!');
  console.log('\nTo run the monitor:');
  console.log('  npm start           - Run in foreground');
  console.log('  npm run pm2:start   - Run as background service with PM2');
  console.log('  npm run pm2:logs    - View logs');
  console.log('  npm run pm2:stop    - Stop the service');
  
  rl.close();
}

setup().catch(console.error);
