# Discord Real-Time Monitor Service

A Node.js service that monitors Discord channels in real-time and logs messages to your Neon PostgreSQL database.

## ⚠️ Important Warning
**Using user tokens for automation violates Discord's Terms of Service.** This tool is for educational purposes only. Use at your own risk.

## 🚀 Features

- **Real-time monitoring** - Captures messages as they're sent
- **Automatic database logging** - Saves to Neon PostgreSQL instantly
- **Message updates tracking** - Captures edits and deletions
- **Reaction monitoring** - Tracks emoji reactions
- **Background service** - Runs 24/7 using PM2
- **Auto-restart** - Recovers from crashes automatically
- **Backfill support** - Import historical messages
- **Health checks** - Monitors database connection
- **Comprehensive logging** - Track all activity

## 📦 Installation

```bash
# Navigate to the monitor directory
cd /Users/franckjones/chatprop/discord-monitor

# Install dependencies
npm install

# Install PM2 globally (for background service)
npm install -g pm2

# Run setup wizard
npm run setup
```

## 🔧 Configuration

The service uses environment variables from `/Users/franckjones/chatprop/.env`:

```env
# Discord Configuration
DISCORD_TOKEN=your_discord_token_here
TARGET_CHANNELS=438036112007626761,other_channel_id

# Database Configuration  
DATABASE_URL=postgresql://...
```

## 📝 Usage

### Start as Foreground Process (for testing)
```bash
npm start
```

### Start as Background Service (recommended)
```bash
# Start the service
npm run pm2:start

# View logs in real-time
npm run pm2:logs

# Stop the service
npm run pm2:stop

# Restart the service
npm run pm2:restart

# Remove the service
npm run pm2:delete
```

### Auto-start on System Boot
```bash
# Generate startup script
pm2 startup

# Follow the instructions, then save current PM2 list
pm2 save
```

### Backfill Historical Messages
```bash
# Backfill last 7 days
node backfill.js 7

# Backfill last 30 days
node backfill.js 30
```

## 📊 What Gets Captured

The monitor captures and stores:
- Message content and ID
- Author information (name, nickname, avatar)
- Timestamps (created, edited)
- Channel and server details
- Attachments (images, files)
- Embeds (links, previews)
- Reactions (emojis)
- User mentions
- User roles

## 🗄️ Database Schema

Messages are stored in the `discord_messages` table with:
- Full message content
- Author metadata
- Channel/guild information
- Attachments as JSON
- Reactions as JSON
- Timestamp indexing for fast queries

## 📈 Monitoring & Logs

### Log Files
- `monitor.log` - All activity
- `error.log` - Errors only
- `logs/out.log` - PM2 stdout
- `logs/error.log` - PM2 stderr

### Health Checks
The service performs automatic health checks every minute to ensure:
- Discord connection is active
- Database is accessible
- No memory leaks

## 🔄 Automatic Features

### When Running as Service:
1. **Auto-restart on crash** - PM2 restarts if service fails
2. **Daily restart** - Cleans memory at 3 AM
3. **Memory limit** - Restarts if using >1GB RAM
4. **Rate limiting** - Prevents Discord API bans
5. **Duplicate prevention** - Won't insert same message twice

## 🛠️ Troubleshooting

### Service won't start
```bash
# Check logs
npm run pm2:logs

# Verify token
node -e "console.log(process.env.DISCORD_TOKEN)"

# Test database connection
node setup.js
```

### Missing messages
- Check TARGET_CHANNELS includes the channel ID
- Verify bot has access to the channel
- Check logs for rate limiting

### High memory usage
```bash
# Restart the service
npm run pm2:restart

# Check memory usage
pm2 monit
```

## 🎯 Integration with Web Viewer

The captured messages are immediately available in your web viewer at:
```
http://localhost:3000
```

Stock ticker analysis updates in real-time as new messages arrive!

## 📚 Scripts Reference

| Script | Description |
|--------|-------------|
| `monitor.js` | Main monitoring service |
| `setup.js` | Configuration wizard |
| `backfill.js` | Import historical messages |
| `ecosystem.config.js` | PM2 configuration |

## 🔐 Security Notes

1. **Never share your Discord token**
2. Store token in `.env` file only
3. Add `.env` to `.gitignore`
4. Use read-only database credentials when possible
5. Monitor logs for suspicious activity

## 📞 Support

If the service stops working:
1. Check Discord hasn't changed their API
2. Verify your token is still valid
3. Check database connection
4. Review error logs
5. Restart the service

---

**Remember:** This tool is for personal use only. Respect Discord's ToS and privacy of other users.
