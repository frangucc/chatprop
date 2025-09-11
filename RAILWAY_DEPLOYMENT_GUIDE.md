# Railway Deployment Guide for ChatProp

This guide walks you through deploying the complete ChatProp trading intelligence platform on Railway.

## Architecture Overview

ChatProp consists of three main services:

1. **chatprop-web** - Next.js web application with real-time WebSocket updates
2. **observant-vibrancy** - Rust service providing live stock prices via Databento
3. **discord-monitor** - Real-time Discord message monitoring and ticker extraction

## Prerequisites

1. **Railway Account** - Sign up at [railway.app](https://railway.app)
2. **Railway CLI** - Install via `npm install -g @railway/cli`
3. **Environment Variables** - Collect all required API keys and tokens

## Required Environment Variables

### Discord Configuration
- `DISCORD_TOKEN` - Your Discord user token (for selfbot monitoring)

### Database
- `DATABASE2_URL` - PostgreSQL connection string (Neon recommended)

### API Keys
- `DATABENTO_API_KEY` - For live stock price data
- `ANTHROPIC_API_KEY` - For AI-powered squawk reports
- `ELEVENLABS_API_KEY` - For audio generation (optional)
- `FINNHUB_API_KEY` - For additional market data
- `ALPHA_API_KEY` - For stock fundamentals
- `OPENAI_KEY` - For AI features

### Internal Communication
- `RUST_SERVICE_URL` - Internal URL for price service communication
- `RAILWAY_PUBLIC_DOMAIN` - Your Railway domain for API routing
- `NEXT_PUBLIC_API_URL` - Public API URL for frontend

## Deployment Steps

### Step 1: Initial Setup

```bash
# Clone and navigate to project
cd /path/to/chatprop

# Login to Railway
railway login

# Link to your Railway project
railway link
```

### Step 2: Deploy the Web Application

```bash
# Deploy the Next.js web app
railway up --service chatprop-web

# Set required environment variables
railway variables set DATABASE2_URL="your_neon_database_url" --service chatprop-web
railway variables set ANTHROPIC_API_KEY="your_anthropic_key" --service chatprop-web  
railway variables set ELEVENLABS_API_KEY="your_elevenlabs_key" --service chatprop-web
railway variables set FINNHUB_API_KEY="your_finnhub_key" --service chatprop-web
railway variables set ALPHA_API_KEY="your_alpha_key" --service chatprop-web
railway variables set OPENAI_KEY="your_openai_key" --service chatprop-web
railway variables set DATABENTO_API_KEY="your_databento_key" --service chatprop-web
```

### Step 3: Deploy the Rust Price Service

```bash
# Deploy the Rust price service
railway up --service observant-vibrancy

# Set required environment variables
railway variables set DATABENTO_API_KEY="your_databento_key" --service observant-vibrancy
railway variables set PORT="7878" --service observant-vibrancy
railway variables set RUST_LOG="info" --service observant-vibrancy
```

### Step 4: Configure Internal Networking

After both services are deployed, set up internal communication:

```bash
# Set Rust service URL for web app to communicate internally
railway variables set RUST_SERVICE_URL="https://observant-vibrancy-production-xxxx.up.railway.app" --service chatprop-web

# Set public domain for internal API routing
railway variables set RAILWAY_PUBLIC_DOMAIN="chatprop-web-production.up.railway.app" --service chatprop-web
railway variables set NEXT_PUBLIC_API_URL="https://chatprop-web-production.up.railway.app" --service chatprop-web
```

**Note:** Replace the URLs with your actual Railway deployment URLs.

### Step 5: Deploy Discord Monitor (Optional)

The Discord monitor provides real-time message processing but has Discord ToS risks.

```bash
# Create and deploy the discord monitor service
railway service create --name discord-monitor
railway up --service discord-monitor

# Set required environment variables
railway variables set DISCORD_TOKEN="your_discord_token" --service discord-monitor
railway variables set DATABASE2_URL="your_neon_database_url" --service discord-monitor
```

## Verification Steps

### 1. Check Web Application
Visit your web app URL: `https://chatprop-web-production.up.railway.app`

- ✅ Homepage loads
- ✅ Stocks page displays ticker data
- ✅ Live prices update (may take a few minutes)
- ✅ Charts display historical data

### 2. Test Rust Price Service
Visit: `https://observant-vibrancy-production-xxxx.up.railway.app`

- ✅ Shows "Live Test Server" message
- ✅ API endpoint responds: `/api/live/prices?symbols=AAPL`

### 3. Verify Database Connection
Check logs for database connectivity:

```bash
railway logs --service chatprop-web
railway logs --service observant-vibrancy
railway logs --service discord-monitor  # if deployed
```

## Troubleshooting

### Common Issues

#### 1. Live Prices Not Working (504 Errors)
- **Problem:** Internal service communication failing
- **Solution:** Verify `RUST_SERVICE_URL` is set correctly
- **Check:** Both services are deployed and running

#### 2. Custom Domain Issues
- **Problem:** API calls fail with unpropagated domain
- **Solution:** Temporarily remove custom domain or wait for DNS propagation
- **Alternative:** Use Railway-provided URLs until domain propagates

#### 3. Discord Monitor Crashes
- **Problem:** Missing dependencies or invalid token
- **Solutions:**
  - Verify `DISCORD_TOKEN` is valid (test locally first)
  - Check all required files are copied to discord-monitor directory
  - Ensure database connection works

#### 4. Database Connection Errors
- **Problem:** Invalid connection string or network issues
- **Solutions:**
  - Verify `DATABASE2_URL` format and credentials
  - Check Neon database is accessible
  - Test connection locally first

#### 5. Build Failures
- **Problem:** Missing dependencies or build errors
- **Solutions:**
  - Check `package.json` includes all dependencies
  - Verify Node.js version compatibility
  - Review build logs for specific errors

### Debugging Commands

```bash
# View service logs
railway logs --service SERVICE_NAME --follow

# Check environment variables  
railway variables --service SERVICE_NAME

# Check service status
railway status

# Redeploy after fixes
railway up --service SERVICE_NAME

# Force rebuild
railway redeploy --service SERVICE_NAME
```

## Monitoring and Maintenance

### Log Monitoring
Monitor your services regularly:

```bash
# Web application logs
railway logs --service chatprop-web --follow

# Price service logs  
railway logs --service observant-vibrancy --follow

# Discord monitor logs (if deployed)
railway logs --service discord-monitor --follow
```

### Key Metrics to Watch
- **Web App:** Response times, error rates, user activity
- **Rust Service:** Price subscription success, API response times
- **Discord Monitor:** Message processing rate, ticker extraction accuracy
- **Database:** Query performance, connection pool health

### Scaling Considerations
- **Traffic:** Railway auto-scales based on demand
- **Database:** Monitor Neon usage and upgrade plan if needed
- **API Limits:** Watch Databento, Anthropic, ElevenLabs usage quotas

## Security Best Practices

1. **Environment Variables:** Never commit secrets to Git
2. **Discord Token:** Monitor for ToS compliance risks
3. **Database:** Use SSL connections and restrict access
4. **API Keys:** Rotate keys periodically
5. **Monitoring:** Set up alerts for unusual activity

## Alternative: Export-Based Approach

For lower Discord ToS risk, consider using the export-based workflow instead of real-time monitoring:

```bash
# Run daily exports locally
./export-today.sh

# Process exports  
cd discord-viewer
npm run process:exports

# This avoids deploying the discord-monitor service entirely
```

## Support and Resources

- **Railway Docs:** [docs.railway.app](https://docs.railway.app)
- **ChatProp Issues:** Check `CLAUDE.md` for project-specific guidance
- **Discord ToS:** Use at your own risk - export approach is safer
- **Database Schema:** See `database-v2/` for table structures

---

**⚠️ Important:** The Discord monitor violates Discord's Terms of Service. Consider the export-based approach for production use to avoid account bans.

**🚀 Success:** Once deployed, your ChatProp platform provides real-time trading intelligence with live prices, AI analysis, and comprehensive ticker tracking!