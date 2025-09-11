FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose port (if needed for health checks)
EXPOSE 3001

# Start with PM2 in foreground mode for Docker
CMD ["npx", "pm2-runtime", "start", "ecosystem.config.js"]