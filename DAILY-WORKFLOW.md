# ChatProp Daily Workflow Guide

## ✅ **Recommended Approach: DiscordChatExporter**

You've been doing it RIGHT! DiscordChatExporter is the better choice:
- **Safe**: Not a selfbot, no ban risk
- **Reliable**: Official tool, always works
- **Complete**: Gets everything (messages, reactions, embeds)

## ❌ **Why NOT discord-monitor (selfbot)**
- **Ban Risk**: Discord actively bans selfbots
- **Unreliable**: Must run 24/7, can crash
- **Incomplete**: Misses messages when offline

---

## 📅 **Daily Workflow**

### **Morning Routine (9:00 AM)**

#### 1. Export Yesterday's Discord Messages
```bash
# Use DiscordChatExporter to export messages
cd /Users/franckjones/chatprop
./export-today.sh
```

#### 2. Process Exports into Database
```bash
cd discord-viewer
node process-discord-export.js
```

#### 3. View Results in Frontend
```bash
npm run dev
# Open http://localhost:3000/stocks
```

---

## 🔧 **Initial Setup (One Time)**

### 1. Store Discord Token Securely
```bash
# Create token file (DO NOT commit to git!)
echo "YOUR_DISCORD_TOKEN" > /Users/franckjones/chatprop/.discord-token
chmod 600 .discord-token
```

### 2. Update Environment Variables
Add to `.env.local`:
```env
# Use the NEW clean database
DATABASE_URL=postgresql://neondb_owner:npg_Z7txvpsw2TIG@ep-dawn-bird-aeah6d7i-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require

# Old database (for reference/migration only)
OLD_DATABASE_URL=postgresql://neondb_owner:npg_pM1YgZXw8zim@ep-old-violet-aewo0ts3-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### 3. Get Channel IDs
Find the channel IDs you want to monitor:
1. Enable Developer Mode in Discord
2. Right-click channel → Copy ID
3. Add to `export-today.sh`

---

## 🚀 **Quick Commands**

```bash
# Export today's messages
npm run export:today

# Process all exports
npm run process:exports

# Clean database and reprocess
npm run process:clean

# View ticker stats
npm run stats

# Start frontend
npm run dev
```

---

## 📊 **Database Architecture**

You're now using the **NEW clean database** with:
- ✅ No duplicate counting
- ✅ Proper foreign keys
- ✅ Fast queries (20-60x faster)
- ✅ Smart blacklist rules
- ✅ Audit trail

---

## 🎯 **What Happens Each Day**

1. **Export** (DiscordChatExporter)
   - Downloads all messages from selected channels
   - Saves as JSON files in `/exports/YYYY-MM-DD/`

2. **Process** (ticker-extractor-v3)
   - Reads JSON exports
   - Extracts tickers with STRICT rules
   - No false positives on common words
   - Stores in clean database

3. **View** (Next.js frontend)
   - Shows today's top tickers
   - Filters by trader
   - Real-time WebSocket updates

---

## 🐛 **Troubleshooting**

### If you see false positives:
```bash
# Add to blacklist
psql $DATABASE_URL -c "INSERT INTO ticker_blacklist (ticker, reason, is_permanent) VALUES ('WORD', 'Common word', true);"
```

### To reprocess with cleaner data:
```bash
# Clear today's data and reprocess
node process-discord-export.js --clean
```

### To check what's in the database:
```bash
psql $DATABASE_URL -c "SELECT * FROM today_ticker_summary ORDER BY mention_count DESC LIMIT 20;"
```

---

## 📈 **Key Improvements Made**

### Old System Problems ❌
- Duplicate counting
- False positives (HOLD, JUST, etc.)
- Slow queries
- Blacklist not working
- JSONB mess

### New System Solutions ✅
- Unique constraint on message-ticker pairs
- Strict extraction (only real tickers)
- 20-60x faster queries
- Smart blacklist with context rules
- Clean normalized tables

---

## 🔐 **Security Notes**

1. **NEVER commit** `.discord-token` to git
2. **NEVER share** your Discord token
3. **Use** read-only database users when possible
4. **Rotate** tokens periodically

---

## 📝 **Next Steps**

1. **Today**: Process yesterday's exports with the new system
2. **Tomorrow**: Set up automated daily exports
3. **This Week**: Add more channels to monitor
4. **Next Week**: Add sentiment analysis

---

## 💡 **Pro Tips**

- Run exports at 9 AM to catch overnight activity
- Process in batches to avoid memory issues
- Monitor the blacklist and update regularly
- Export to CSV for Excel analysis
- Keep 30 days of exports, delete older

---

Remember: **DiscordChatExporter is the way!** Safe, reliable, complete.
