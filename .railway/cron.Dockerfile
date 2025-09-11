FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash \
    ca-certificates \
    git \
    dcron

WORKDIR /app

# Copy package files from discord-viewer
COPY discord-viewer/package*.json ./
RUN npm ci --only=production

# Copy necessary files for cron jobs
COPY discord-viewer/*.js ./
COPY discord-viewer/lib/ ./lib/
COPY discord-viewer/migrations/ ./migrations/
COPY export-today.sh ./
COPY .discord-token ./

# Make scripts executable
RUN chmod +x export-today.sh

# Create exports directory
RUN mkdir -p exports

# Create log directory
RUN mkdir -p /var/log && touch /var/log/export.log /var/log/process.log

# Set up cron jobs
RUN echo "0 8 * * * cd /app && ./export-today.sh >> /var/log/export.log 2>&1" > /etc/crontabs/root
RUN echo "15 8 * * * cd /app && node process-discord-export.js >> /var/log/process.log 2>&1" >> /etc/crontabs/root
RUN echo "30 8 * * * cd /app && node batch-extractor.js >> /var/log/batch.log 2>&1" >> /etc/crontabs/root

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD ps aux | grep crond || exit 1

# Start cron daemon
CMD ["crond", "-f", "-l", "2"]