#!/bin/bash

echo "Stopping ChatProp services..."

# Stop processes on common ports
echo "Killing processes on port 3000 (Next.js)..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

echo "Killing processes on port 7878 (Databento Rust service)..."
lsof -ti:7878 | xargs kill -9 2>/dev/null || true

# Kill any remaining related processes
echo "Killing any remaining Next.js/Node processes..."
pkill -f "next-server" 2>/dev/null || true
pkill -f "npm.*dev" 2>/dev/null || true
pkill -f "node.*next" 2>/dev/null || true

echo "Killing Databento service..."
pkill -f "databento-live-test" 2>/dev/null || true

echo "All services stopped!"
