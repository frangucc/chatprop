use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    time::{SystemTime, UNIX_EPOCH, Duration},
};

use anyhow::Result;
use axum::{
    extract::{Query, State},
    http::Method,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use http::StatusCode;
use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, mpsc};
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use reqwest::header::{AUTHORIZATION, ACCEPT};
use base64::Engine as _;
use chrono::{DateTime, Utc, Duration as ChronoDuration};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::stream::StreamExt;
use futures_util::SinkExt;
// Databento live client
use databento::{live::Subscription, LiveClient};
use databento::dbn::{Schema, SType, TradeMsg};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct LastPrice {
    price: Option<f64>,
    ts_event_ns: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
struct PriceUpdate {
    symbol: String,
    price: f64,
    timestamp: u64,
}

#[derive(Clone)]
struct AppState {
    prices: std::sync::Arc<RwLock<HashMap<String, LastPrice>>>,
    live_client: std::sync::Arc<RwLock<Option<databento::LiveClient>>>,
    subscribed_symbols: std::sync::Arc<RwLock<HashSet<String>>>,
    symbol_mapping: std::sync::Arc<RwLock<HashMap<u32, String>>>, // instrument_id -> symbol
    price_sender: mpsc::UnboundedSender<PriceUpdate>,
    client_sender: mpsc::UnboundedSender<Vec<String>>, // Channel to send new symbols to the single client task
}

#[derive(Debug, Deserialize)]
struct PricesQuery {
    symbols: String,
}

#[derive(Debug, Serialize)]
struct PricesResponseItem {
    symbol: String,
    price: Option<f64>,
    ts_event_ns: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SubscribeBody {
    symbols: Vec<String>,
}

// Helper: normalize symbol keys
fn norm_symbol(s: &str) -> String { s.trim().to_uppercase() }

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    
    // Create channels for price broadcasting and client communication
    let (price_sender, price_receiver) = mpsc::unbounded_channel::<PriceUpdate>();
    let (client_sender, client_receiver) = mpsc::unbounded_channel::<Vec<String>>();
    
    // Initialize state
    let state = AppState {
        prices: std::sync::Arc::new(RwLock::new(HashMap::new())),
        live_client: std::sync::Arc::new(RwLock::new(None)),
        subscribed_symbols: std::sync::Arc::new(RwLock::new(HashSet::new())),
        symbol_mapping: std::sync::Arc::new(RwLock::new(HashMap::new())),
        price_sender,
        client_sender,
    };
    
    // Initialize logging FIRST
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Start single Databento client manager
    let state_clone = state.clone();
    tokio::spawn(databento_client_manager(state_clone, client_receiver));
    
    // Start WebSocket broadcaster to Node.js server
    let websocket_url = std::env::var("NODEJS_WS_URL").unwrap_or_else(|_| "ws://localhost:3000/ws".to_string());
    tokio::spawn(start_websocket_broadcaster(websocket_url, price_receiver));

    // CORS to allow Next.js dev origin
    let cors = CorsLayer::new()
        .allow_origin("http://localhost:3000".parse::<http::HeaderValue>().unwrap())
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any)
        .max_age(Duration::from_secs(24 * 60 * 60));
    let app = Router::new()
        .route("/", get(|| async { "Live Test Server" }))
        .route("/api/live/prices", get(get_prices))
        .route("/api/live/ingest_hist", post(ingest_hist))
        .route("/subscribe", post(subscribe))
        .route("/api/live/all", get(get_all_prices))
        .route("/ingest_one", post(ingest_one))
        .with_state(state.clone())
        .layer(cors);

    // Start background Databento live subscriber for Trades
    // Dataset: default to EQUS.MINI for live
    // Don't start any hardcoded subscriptions - wait for dynamic subscriptions from the UI

    let addr: SocketAddr = "0.0.0.0:7878".parse().unwrap();
    info!(?addr, "Starting live server");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await.map_err(Into::into)
}

async fn get_prices(Query(params): Query<PricesQuery>, State(app_state): State<AppState>) -> impl IntoResponse {
    let symbols: Vec<String> = params.symbols.split(',').map(|s| s.to_string()).collect();
    let prices = app_state.prices.read().await;
    
    info!("get_prices: requested symbols={:?}, available keys={:?}", symbols, prices.keys().collect::<Vec<_>>());
    
    let mut result = std::collections::HashMap::new();
    
    for symbol in symbols {
        if let Some(price) = prices.get(&symbol) {
            result.insert(symbol, price.clone());
        }
    }
    
    info!("get_prices: returning {} results", result.len());
    Json(result)
}

// Handler to get ALL prices (including instrument IDs)
async fn get_all_prices(State(app_state): State<AppState>) -> impl IntoResponse {
    let prices = app_state.prices.read().await;
    info!("get_all_prices: {} entries available", prices.len());
    let all_prices: std::collections::HashMap<String, LastPrice> = prices.clone();
    Json(all_prices)
}

// Placeholder: accept subscription list. In a later step, wire this to Databento and start/refresh the live feed.
async fn subscribe(
    State(state): State<AppState>,
    Json(body): Json<SubscribeBody>,
) -> impl IntoResponse {
    info!("Subscribe request for symbols: {:?}", body.symbols);
    
    // Get API key and dataset from env
    let api_key = match std::env::var("DATABENTO_API_KEY") {
        Ok(key) => key,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": "DATABENTO_API_KEY not set"
            })));
        }
    };
    
    let dataset = std::env::var("DATABENTO_DATASET").unwrap_or("EQUS.MINI".to_string());
    
    // Filter new symbols we haven't subscribed to yet
    let mut new_symbols = Vec::new();
    let has_active_prices = {
        let prices = state.prices.read().await;
        !prices.is_empty()
    };
    
    {
        let subscribed = state.subscribed_symbols.read().await;
        for sym in &body.symbols {
            let norm = norm_symbol(sym);
            // If we have no active prices, force resubscription even if in the set
            if !has_active_prices || !subscribed.contains(&norm) {
                new_symbols.push(norm);
            }
        }
    }
    
    if new_symbols.is_empty() {
        return (StatusCode::OK, Json(serde_json::json!({
            "status": "ok", 
            "message": "All symbols already subscribed"
        })));
    }
    
    info!("New symbols to subscribe: {:?}", new_symbols);
    
    // Create a new live client for these symbols
    match start_live_subscription(
        api_key,
        dataset,
        new_symbols.clone(),
        state.clone()
    ).await {
        Ok(actually_subscribed) => {
            // Mark symbols as subscribed
            let mut subscribed = state.subscribed_symbols.write().await;
            for sym in &actually_subscribed {
                subscribed.insert(sym.clone());
            }
            
            // Wait a moment to see if we get symbol mappings
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            // Check which symbols actually have data
            let valid_count = {
                let prices = state.prices.read().await;
                actually_subscribed.iter()
                    .filter(|sym| prices.contains_key(*sym) || 
                           prices.keys().any(|k| k.starts_with("INST:")))
                    .count()
            };
            
            (StatusCode::OK, Json(serde_json::json!({
                "status": "ok",
                "requested": body.symbols.len(),
                "subscribed": actually_subscribed.len(),
                "valid": valid_count
            })))
        }
        Err(e) => {
            error!("Failed to subscribe: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "error": format!("Failed to subscribe: {}", e)
            })))
        }
    }
}

#[derive(Debug, Deserialize)]
struct IngestOneBody { symbol: String, price: f64, #[serde(default)] ts_event_ns: Option<u64> }

// Optional manual ingest for testing end-to-end while live feed is not wired.
async fn ingest_one(
    State(state): State<AppState>,
    Json(body): Json<IngestOneBody>,
) -> impl IntoResponse {
    let key = norm_symbol(&body.symbol);
    let mut map = state.prices.write().await;
    map.insert(
        key.clone(),
        LastPrice { price: Some(body.price), ts_event_ns: body.ts_event_ns.or(Some(current_time_ns())) },
    );
    info!(symbol = %key, price = body.price, "ingested test price");
    (StatusCode::OK, Json(serde_json::json!({"status": "ok"})))
}

#[derive(Debug, Deserialize)]
struct IngestHistBody { symbol: String, timestamp: String }

// POST /ingest_hist { symbol, timestamp: RFC3339 }
async fn ingest_hist(
    State(state): State<AppState>,
    Json(body): Json<IngestHistBody>,
) -> impl IntoResponse {
    let api_key = match std::env::var("DATABENTO_API_KEY") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            warn!("DATABENTO_API_KEY not set");
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "DATABENTO_API_KEY not configured"})));
        }
    };

    let symbol = norm_symbol(&body.symbol);
    let ts: DateTime<Utc> = match DateTime::parse_from_rfc3339(&body.timestamp) {
        Ok(dt) => dt.with_timezone(&Utc),
        Err(e) => {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("invalid timestamp: {}", e)})));
        }
    };

    // 2-second window around timestamp (1s before to 1s after)
    let start_dt = ts - ChronoDuration::seconds(1);
    let end_dt = start_dt + ChronoDuration::seconds(2);
    
    // Use RFC3339 with fixed offset to avoid timezone issues
    let start_str = start_dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let end_str = end_dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    
    info!(symbol = %symbol, start = %start_str, end = %end_str, "Databento query window");

    // Dataset: default to EQUS.MINI for US Equities
    let dataset = std::env::var("DATABENTO_DATASET").unwrap_or_else(|_| "EQUS.MINI".to_string());
    let url = format!(
        "https://hist.databento.com/v0/timeseries.get_range?dataset={}&symbols={}&stype_in=raw_symbol&start={}&end={}&schema=trades&encoding=json&limit=100",
        dataset,
        symbol,
        start_str,
        end_str
    );

    // HTTP Basic auth with API key as username and empty password => base64("<APIKEY>:")
    let userpass = format!("{}:", api_key);
    let auth_b64 = base64::engine::general_purpose::STANDARD.encode(userpass);

    let client = reqwest::Client::new();
    let resp = match client
        .get(&url)
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, format!("Basic {}", auth_b64))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            error!(error = %e, "databento request failed");
            return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": "upstream request failed"})));
        }
    };

    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        warn!(%code, %text, "databento non-200");
        return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": "upstream error", "status": code.as_u16()})));
    }

    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": format!("failed reading body: {}", e)})));
        }
    };

    let mut total_px: f64 = 0.0;
    let mut total_sz: f64 = 0.0;
    let mut min_px = f64::INFINITY;
    let mut max_px = f64::NEG_INFINITY;
    let mut trades = 0u64;
    for line in body_text.lines() {
        if line.trim().is_empty() { continue; }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            let price_raw = val.get("price").and_then(|v| v.as_f64());
            let size = val.get("size").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if let Some(pnanos) = price_raw {
                let px = pnanos / 1_000_000_000.0; // nanos to dollars
                if size > 0.0 { total_px += px * size; total_sz += size; }
                if px.is_finite() { if px < min_px { min_px = px; } if px > max_px { max_px = px; } }
                trades += 1;
            }
        }
    }

    if trades == 0 {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no trades in window"})));
    }

    let vwap = if total_sz > 0.0 { total_px / total_sz } else { (min_px + max_px) / 2.0 };

    {
        let mut map = state.prices.write().await;
        map.insert(symbol.clone(), LastPrice { price: Some(vwap), ts_event_ns: Some(current_time_ns()) });
    }
    info!(symbol = %symbol, price = vwap, trades, "ingested from Databento window");
    (StatusCode::OK, Json(serde_json::json!({"status": "ok", "symbol": symbol, "price": vwap, "trades": trades})))
}

fn current_time_ns() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64
}

async fn start_live_subscription(
    _api_key: String,
    _dataset: String,
    symbols: Vec<String>,
    state: AppState
) -> Result<Vec<String>> {
    if symbols.is_empty() {
        return Ok(vec![]);
    }

    // Send symbols to the single client manager instead of creating new connections
    if let Err(e) = state.client_sender.send(symbols.clone()) {
        error!("Failed to send symbols to client manager: {}", e);
        return Err(anyhow::anyhow!("Client manager communication failed"));
    }

    // Mark symbols as subscribed immediately (the client manager will handle actual subscription)
    {
        let mut subscribed = state.subscribed_symbols.write().await;
        for sym in &symbols {
            subscribed.insert(sym.clone());
        }
    }

    info!("Requested subscription for symbols: {:?}", symbols);
    Ok(symbols)
}

// Single Databento client manager that handles all subscriptions
async fn databento_client_manager(
    state: AppState,
    mut symbol_receiver: mpsc::UnboundedReceiver<Vec<String>>
) {
    let api_key = match std::env::var("DATABENTO_API_KEY") {
        Ok(key) => key,
        Err(_) => {
            error!("DATABENTO_API_KEY not set for client manager");
            return;
        }
    };
    
    let dataset = std::env::var("DATABENTO_DATASET").unwrap_or("EQUS.MINI".to_string());
    info!("Starting Databento client manager with dataset: {}", dataset);
    
    let mut client = match LiveClient::builder()
        .key(&api_key)
        .unwrap()
        .dataset(&dataset)
        .build()
        .await
    {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to create Databento client: {}", e);
            return;
        }
    };
    
    let mut subscribed_instruments: HashSet<String> = HashSet::new();
    let mut client_started = false;
    
    loop {
        tokio::select! {
            // Handle new symbol subscription requests
            symbols_opt = symbol_receiver.recv() => {
                if let Some(symbols) = symbols_opt {
                    info!("Client manager received subscription request for: {:?}", symbols);
                    
                    // Filter to new symbols only
                    let mut new_symbols = Vec::new();
                    for sym in symbols {
                        if !subscribed_instruments.contains(&sym) {
                            new_symbols.push(sym.clone());
                            subscribed_instruments.insert(sym);
                        }
                    }
                    
                    if !new_symbols.is_empty() {
                        info!("Subscribing to new symbols: {:?}", new_symbols);
                        
                        // Create subscription for all new symbols at once
                        let subscription = Subscription::builder()
                            .schema(Schema::Trades)
                            .stype_in(SType::RawSymbol)
                            .symbols(new_symbols.clone())
                            .build();
                            
                        match client.subscribe(&subscription).await {
                            Ok(_) => {
                                info!("Successfully subscribed to {} symbols", new_symbols.len());
                                
                                // Start the client if this is the first subscription
                                if !client_started {
                                    match client.start().await {
                                        Ok(_) => {
                                            info!("Databento client started");
                                            client_started = true;
                                        }
                                        Err(e) => {
                                            error!("Failed to start Databento client: {}", e);
                                            // Remove symbols from subscribed set since start failed
                                            for sym in &new_symbols {
                                                subscribed_instruments.remove(sym);
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                error!("Failed to subscribe to symbols {:?}: {}", new_symbols, e);
                                // Remove symbols from subscribed set since subscription failed
                                for sym in &new_symbols {
                                    subscribed_instruments.remove(sym);
                                }
                            }
                        }
                    }
                } else {
                    warn!("Symbol receiver channel closed");
                    break;
                }
            }
            
            // Handle incoming trade data (only if client is started)
            rec_result = client.next_record(), if client_started => {
                match rec_result {
                    Ok(Some(rec)) => {
                        // Handle symbol mapping messages
                        if let Some(mapping) = rec.get::<databento::dbn::SymbolMappingMsg>() {
                            let raw_symbol = unsafe {
                                std::ffi::CStr::from_ptr(mapping.stype_out_symbol.as_ptr() as *const i8)
                                    .to_string_lossy()
                                    .into_owned()
                            };
                            info!("Symbol mapping: instrument_id={} -> symbol={}", mapping.hd.instrument_id, raw_symbol);
                            
                            // Store the mapping
                            {
                                let mut mappings = state.symbol_mapping.write().await;
                                mappings.insert(mapping.hd.instrument_id, raw_symbol.clone());
                            }
                        }
                        
                        // Handle trade messages
                        if let Some(trade) = rec.get::<TradeMsg>() {
                            let px = trade.price as f64 / 1_000_000_000.0;
                            let inst = trade.hd.instrument_id;
                            
                            // Get the actual symbol from the mapping
                            let symbol = {
                                let mappings = state.symbol_mapping.read().await;
                                mappings.get(&inst).cloned().unwrap_or_else(|| format!("INST:{}", inst))
                            };
                            
                            info!("Live trade: instrument_id={}, symbol={}, price=${:.4}", inst, symbol, px);
                            
                            // Store price data with actual symbol
                            {
                                let mut map = state.prices.write().await;
                                map.insert(symbol.clone(), LastPrice { price: Some(px), ts_event_ns: Some(trade.hd.ts_event) });
                            }
                            
                            // Send price update via WebSocket with actual symbol
                            let price_update = PriceUpdate {
                                symbol: symbol,
                                price: px,
                                timestamp: trade.hd.ts_event,
                            };
                            
                            if let Err(e) = state.price_sender.send(price_update) {
                                warn!("Failed to send price update: {}", e);
                            }
                        }
                    }
                    Ok(None) => {
                        info!("Databento stream ended");
                        client_started = false;
                        break;
                    }
                    Err(e) => {
                        error!("Databento client error: {}", e);
                        client_started = false;
                        // Try to reconnect after a delay
                        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                        break;
                    }
                }
            }
        }
    }
    
    info!("Databento client manager stopped");
}

async fn start_websocket_broadcaster(url: String, mut price_receiver: mpsc::UnboundedReceiver<PriceUpdate>) {
    loop {
        info!("Attempting to connect to WebSocket at {}", url);
        match connect_async(&url).await {
            Ok((ws_stream, _)) => {
                info!("Connected to WebSocket server");
                let (mut ws_sender, mut ws_receiver) = ws_stream.split();
                
                // Send price updates via WebSocket
                loop {
                    tokio::select! {
                        price_update = price_receiver.recv() => {
                            if let Some(update) = price_update {
                                let msg = Message::Text(serde_json::to_string(&update).unwrap());
                                if let Err(e) = ws_sender.send(msg).await {
                                    error!("Failed to send price update: {}", e);
                                    break;
                                }
                                info!("Broadcasted price: {} @ ${:.4}", update.symbol, update.price);
                            } else {
                                warn!("Price receiver channel closed");
                                break;
                            }
                        }
                        ws_msg = ws_receiver.next() => {
                            if let Some(msg) = ws_msg {
                                match msg {
                                    Ok(Message::Close(_)) => {
                                        info!("WebSocket connection closed by server");
                                        break;
                                    }
                                    Err(e) => {
                                        error!("WebSocket error: {}", e);
                                        break;
                                    }
                                    _ => {} // Ignore other message types
                                }
                            } else {
                                info!("WebSocket stream ended");
                                break;
                            }
                        }
                    }
                }
                
                info!("WebSocket connection lost, will reconnect in 5 seconds");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
            Err(e) => {
                error!("Failed to connect to WebSocket: {}. Retrying in 10 seconds", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        }
    }
}
