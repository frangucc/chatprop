#!/usr/bin/env bash
set -euo pipefail

# ChatProp management script
# Usage:
#   scripts/manage.sh start        # export today, catch up processing, start servers
#   scripts/manage.sh start-webonly # start only web app and rust server (no monitor/extraction)
#   scripts/manage.sh stop         # stop all servers
#   scripts/manage.sh status       # show status of servers and latest exports

ROOT_DIR="/Users/franckjones/chatprop"
EXPORT_DIR="$ROOT_DIR/exports"
VIEWER_DIR="$ROOT_DIR/discord-viewer"
MONITOR_DIR="$ROOT_DIR/discord-monitor"
RUST_DIR="$VIEWER_DIR/databento-live-test"
OUTPUT_DIR="$VIEWER_DIR/output"
DB_URL="${DATABASE2_URL:-postgresql://neondb_owner:npg_Z7txvpsw2TIG@ep-dawn-bird-aeah6d7i-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require}"

TODAY=$(date '+%Y-%m-%d')
CSV_TODAY="$OUTPUT_DIR/tickers-$TODAY.csv"

ensure_dirs() {
  mkdir -p "$OUTPUT_DIR"
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

pm2_safe() {
  if have_cmd pm2; then pm2 "$@"; else echo "pm2 not installed"; fi
}

is_weekend() {
  # 6=Saturday, 7=Sunday
  local d="$1"
  local dow
  dow=$(date -j -f "%Y-%m-%d" "$d" +%u 2>/dev/null || date -d "$d" +%u)
  [[ "$dow" == "6" || "$dow" == "7" ]]
}

last_processed_date() {
  # Reads the most recent stat_date we have in DB (guides catch-up)
  if ! have_cmd psql; then
    echo "1970-01-01"; return
  fi
  PGPASSWORD="" psql "$DB_URL" -At -c "select coalesce(max(stat_date), '1970-01-01') from ticker_daily_stats" 2>/dev/null | head -n1 | tr -d '\r'
}

export_today() {
  if is_weekend "$TODAY"; then
    echo "==> Today is weekend ($TODAY). Skipping export."
    return 0
  fi
  echo "==> Exporting today's Discord messages: $TODAY"
  chmod +x "$ROOT_DIR/export-today.sh" || true
  "$ROOT_DIR/export-today.sh"
}

process_folder() {
  local folder="$1"
  echo "==> Processing exports in: $folder"
  (cd "$VIEWER_DIR" && node process-discord-export.js --folder "$folder" --export)
}

catch_up_processing() {
  echo "==> Catching up unprocessed export folders (DB-guided)"
  ensure_dirs
  local last_date
  last_date=$(last_processed_date)
  echo "-- Last processed date in DB: $last_date"

  shopt -s nullglob
  # Only consider YYYY-MM-DD directories directly under exports (skip 'archive' by default)
  for dir in "$EXPORT_DIR"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]; do
    [ -d "$dir" ] || continue
    local date_part
    date_part=$(basename "$dir")

    # Skip weekends
    if is_weekend "$date_part"; then
      echo "-- Skipping weekend: $date_part"
      continue
    fi

    # Only process dates strictly after last_date
    if [ "$date_part" \> "$last_date" ]; then
      local csv="$OUTPUT_DIR/tickers-$date_part.csv"
      if [ ! -f "$csv" ]; then
        echo "-- Pending: $date_part (after $last_date, no $csv)"
        process_folder "$dir"
      else
        echo "-- Already processed (csv exists): $date_part"
      fi
    else
      echo "-- Skipping $date_part (<= DB last date $last_date)"
    fi
  done
}

port_listening() {
  local port="$1"
  lsof -i TCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

start_servers() {
  echo "==> Starting servers"
  # PM2: monitor + extractor (defined in ecosystem)
  if have_cmd pm2; then
    (cd "$MONITOR_DIR" && pm2 start ecosystem.config.js)
  else
    echo "pm2 not found; please install pm2 (npm i -g pm2)"
  fi

  start_web_servers
  pm2_safe save || true
}

start_web_servers() {
  echo "==> Starting web servers only"
  
  # Start Next.js dev via PM2 if not already listening
  if port_listening 3000; then
    echo "Port 3000 already in use; skipping Next.js dev start"
  else
    # Use server.js to enable WebSocket support for real-time ticker updates
    pm2_safe start "$VIEWER_DIR/server.js" --name discord-viewer-dev --cwd "$VIEWER_DIR" || \
    (cd "$VIEWER_DIR" && nohup node server.js >/tmp/discord-viewer-dev.log 2>&1 & echo "Started Next.js with WebSocket via nohup (fallback)")
  fi

  # Start Rust live server on 7878 via PM2 if nothing is bound or named already
  if port_listening 7878; then
    echo "Port 7878 already in use; skipping Rust server start"
  else
    # Use start.sh to ensure .env.local is loaded (DATABENTO_API_KEY, etc.)
    if [ -x "$RUST_DIR/start.sh" ]; then
      pm2_safe start "$RUST_DIR/start.sh" --name databento-live-server --interpreter bash || \
      (cd "$RUST_DIR" && nohup bash ./start.sh >/tmp/rust-live-server.log 2>&1 & echo "Started Rust server via nohup (fallback)")
    else
      # Fallback to cargo run if start.sh missing (env may be incomplete)
      pm2_safe start cargo --name databento-live-server -- run --cwd "$RUST_DIR" || \
      (cd "$RUST_DIR" && nohup cargo run >/tmp/rust-live-server.log 2>&1 & echo "Started Rust server via nohup (fallback)")
    fi
  fi
}

stop_servers() {
  echo "==> Stopping all servers"
  # Stop known PM2 apps if present
  pm2_safe delete discord-monitor || true
  pm2_safe delete ticker-extractor || true
  stop_web_servers_only
}

stop_web_servers_only() {
  echo "==> Stopping web servers only"
  pm2_safe delete discord-viewer-dev || true
  pm2_safe delete databento-live-server || true

  # Optionally, stop any process listening on 3000/7878 that PM2 didn't manage
  # (Be conservative: only kill if clearly a nohup from our logs)
  for port in 3000 7878; do
    local pids
    pids=$(lsof -t -i TCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    for pid in $pids; do
      if ps -o command= -p "$pid" | grep -E "(node .*discord-viewer|cargo run|rust-live-server|live_serv)" >/dev/null 2>&1; then
        echo "Killing PID $pid on port $port"
        kill "$pid" || true
      fi
    done
  done
}

show_status() {
  echo "==> Status"
  echo "-- Exports dir: $EXPORT_DIR"
  echo "-- Output dir:  $OUTPUT_DIR"
  echo "-- Today CSV:   ${CSV_TODAY:-"(none)"} $( [ -f "$CSV_TODAY" ] && echo "[exists]" || echo "[missing]")"
  echo
  pm2_safe status || true
  echo
  echo "Listeners:"
  lsof -nP -i TCP:3000 -sTCP:LISTEN || true
  lsof -nP -i TCP:7878 -sTCP:LISTEN || true
}

is_running() {
  # Check if any of our key services are running
  pm2_safe list 2>/dev/null | grep -E "(discord-monitor|ticker-extractor|discord-viewer-dev|databento-live-server)" | grep -q "online"
}

is_web_only_running() {
  # Check if web services are running
  pm2_safe list 2>/dev/null | grep -E "(discord-viewer-dev|databento-live-server)" | grep -q "online"
}

is_monitor_running() {
  # Check if monitor/extraction services are running
  pm2_safe list 2>/dev/null | grep -E "(discord-monitor|ticker-extractor)" | grep -q "online"
}

main() {
  local cmd="${1:-status}"
  local flag="${2:-}"
  
  # Handle flag syntax: "start -webonly" -> "start-webonly"
  if [[ "$cmd" == "start" && "$flag" == "-webonly" ]]; then
    cmd="start-webonly"
  fi
  
  case "$cmd" in
    start)
      if is_running; then
        echo "==> Services are running. Performing restart..."
        stop_servers
        echo "==> Waiting for cleanup..."
        sleep 2
        echo "==> Starting fresh with full catch-up..."
      else
        echo "==> Services are stopped. Performing fresh start..."
      fi
      ensure_dirs
      export_today
      catch_up_processing
      start_servers
      echo "==> All services started! Web UI: http://localhost:3000"
      ;;
    start-webonly)
      if is_web_only_running; then
        echo "==> Web services are running. Performing restart..."
        stop_web_servers_only
        echo "==> Waiting for cleanup..."
        sleep 2
        echo "==> Starting web services only..."
      else
        echo "==> Web services are stopped. Starting web servers only..."
      fi
      ensure_dirs
      start_web_servers
      pm2_safe save || true
      echo "==> Web services started! Web UI: http://localhost:3000"
      echo "==> NOTE: Monitor and extraction services NOT started (webonly mode)"
      ;;
    start-lite)
      # Start only the servers, skip exports and catch-up processing
      ensure_dirs
      start_servers
      ;;
    stop)
      # Smart stop: if only web services are running, stop only those
      if is_web_only_running && ! is_monitor_running; then
        echo "==> Only web services detected, stopping web services only"
        stop_web_servers_only
      else
        echo "==> Stopping all services"
        stop_servers
      fi
      ;;
    status)
      show_status
      ;;
    *)
      echo "Usage: $0 {start|start-webonly|start -webonly|start-lite|stop|status}" >&2
      exit 1
      ;;
  esac
}

main "$@"
