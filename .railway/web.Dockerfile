FROM node:18-alpine

WORKDIR /app

# Copy discord-viewer package files
COPY discord-viewer/package*.json ./
RUN npm ci --only=production

# Copy discord-viewer application code
COPY discord-viewer/ ./

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/stocks || exit 1

# Start the application with WebSocket support
CMD ["npm", "run", "railway:start"]