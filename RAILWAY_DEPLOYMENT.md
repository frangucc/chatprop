# 🚀 Railway Deployment Guide

## Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **Railway CLI**: Install via `npm install -g @railway/cli`
3. **Git Repository**: Push your code to GitHub/GitLab

## 📋 Deployment Steps

### Step 1: Login to Railway
```bash
railway login
```

### Step 2: Create Railway Project
```bash
railway link
# Or create new project:
railway init
```

### Step 3: Deploy Services (in order)

#### 🌐 Service 1: Web App (Main Next.js Application)
```bash
# Create web service
railway service new web-app
railway service connect web-app

# Set Dockerfile
railway variables set RAILWAY_DOCKERFILE_PATH=.railway/web.Dockerfile

# Deploy
railway up --service web-app
```

**Required Environment Variables for Web App:**
```
DATABASE2_URL=postgresql://your-neon-db-url
ANTHROPIC_API_KEY=sk-ant-api03-your-key
ELEVENLABS_API_KEY=sk_your-key
FINNHUB_API_KEY=your-key
ALPHA_API_KEY=your-key
NODE_ENV=production
RUST_PRICE_SERVICE_URL=http://rust-prices.railway.internal:7878
PORT=3000
```

#### ⚡ Service 2: Rust Price Service
```bash
# Create rust service
railway service new rust-prices
railway service connect rust-prices

# Set Dockerfile
railway variables set RAILWAY_DOCKERFILE_PATH=.railway/rust.Dockerfile

# Deploy
railway up --service rust-prices
```

**Required Environment Variables for Rust Service:**
```
DATABENTO_API_KEY=db-your-key
RUST_LOG=info
PORT=7878
```

#### ⏰ Service 3: Cron Worker
```bash
# Create cron service
railway service new cron-worker
railway service connect cron-worker

# Set Dockerfile
railway variables set RAILWAY_DOCKERFILE_PATH=.railway/cron.Dockerfile

# Deploy
railway up --service cron-worker
```

**Required Environment Variables for Cron Worker:**
```
DATABASE2_URL=postgresql://your-neon-db-url
DISCORD_TOKEN=your-token
NODE_ENV=production
```

### Step 4: Configure Internal Networking

In the web-app service, update the Rust service URL to use Railway's internal networking:
```
RUST_PRICE_SERVICE_URL=http://rust-prices.railway.internal:7878
```

### Step 5: Set Up Custom Domains (Optional)
```bash
railway domain
# Follow prompts to set up custom domain
```

## 🔧 Post-Deployment Configuration

### Update Next.js API Routes
Update `/discord-viewer/app/api/live/prices/route.ts` to use the internal service URL:

```typescript
const RUST_SERVICE_URL = process.env.RUST_PRICE_SERVICE_URL || 'http://localhost:7878';

const response = await fetch(`${RUST_SERVICE_URL}/api/live/prices?symbols=${symbols}`);
```

### Database Connection
Ensure your Neon database allows connections from Railway IPs. Railway provides static IPs for database connections.

## 📊 Monitoring & Logs

```bash
# View logs for each service
railway logs --service web-app
railway logs --service rust-prices
railway logs --service cron-worker

# Monitor resource usage
railway status
```

## 🔄 CI/CD Setup (Optional)

Create `.github/workflows/railway.yml`:
```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install -g @railway/cli
      - run: railway login --token ${{ secrets.RAILWAY_TOKEN }}
      - run: railway up --service web-app
      - run: railway up --service rust-prices  
      - run: railway up --service cron-worker
```

## 💰 Expected Costs

- **Web App Service**: ~$5-10/month (based on usage)
- **Rust Price Service**: ~$5/month
- **Cron Worker**: ~$5/month
- **Total**: ~$15-20/month

## 🔍 Troubleshooting

### Common Issues:

1. **Build Failures**: Check Dockerfile syntax and paths
2. **Database Connection**: Verify DATABASE2_URL is set correctly
3. **Internal Networking**: Ensure services use `.railway.internal` URLs
4. **Environment Variables**: Double-check all required vars are set

### Debug Commands:
```bash
# Check service status
railway status

# View real-time logs
railway logs --follow

# Check environment variables
railway variables

# Restart a service
railway restart --service web-app
```

## 🚀 Deployment Checklist

- [ ] Railway account created and CLI installed
- [ ] Project linked to Railway
- [ ] Web app service deployed with all environment variables
- [ ] Rust price service deployed and responding
- [ ] Cron worker service deployed
- [ ] Internal networking configured
- [ ] Database connections working
- [ ] Live prices flowing
- [ ] Squawk reports generating
- [ ] Cron jobs running (check logs at 8:00 AM)

## 🔄 Updates & Maintenance

To update any service:
```bash
# Make your code changes, then:
git push
railway up --service [service-name]
```

Railway will automatically rebuild and redeploy the updated service.

## 📞 Support

If you encounter issues:
1. Check Railway's status page
2. Review service logs
3. Verify environment variables
4. Test database connectivity
5. Check Discord token validity