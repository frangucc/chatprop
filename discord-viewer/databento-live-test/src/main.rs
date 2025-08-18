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
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use reqwest::header::{AUTHORIZATION, ACCEPT};
use base64::Engine as _;
use chrono::{DateTime, Utc, Duration as ChronoDuration};
// Databento live client
use databento::{live::Subscription, LiveClient};
use databento::dbn::{Schema, SType, TradeMsg};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct LastPrice {
    price: Option<f64>,
    ts_event_ns: Option<u64>,
}

#[derive(Clone)]
struct AppState {
    prices: std::sync::Arc<RwLock<HashMap<String, LastPrice>>>,
    live_client: std::sync::Arc<RwLock<Option<databento::LiveClient>>>,
    subscribed_symbols: std::sync::Arc<RwLock<HashSet<String>>>,
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
    
    // Initialize state with prices from the live feed once ready.
    let state = AppState {
        prices: std::sync::Arc::new(RwLock::new(HashMap::new())),
        live_client: std::sync::Arc::new(RwLock::new(None)),
        subscribed_symbols: std::sync::Arc::new(RwLock::new(HashSet::new())),
    };

    // logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

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
    {
        let subscribed = state.subscribed_symbols.read().await;
        for sym in &body.symbols {
            let norm = norm_symbol(sym);
            if !subscribed.contains(&norm) {
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
        Ok(_) => {
            // Mark symbols as subscribed
            let mut subscribed = state.subscribed_symbols.write().await;
            for sym in new_symbols {
                subscribed.insert(sym);
            }
            
            (StatusCode::OK, Json(serde_json::json!({
                "status": "ok",
                "subscribed": body.symbols.len()
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
    api_key: String,
    dataset: String,
    symbols: Vec<String>,
    state: AppState
) -> Result<()> {
    if symbols.is_empty() {
        return Ok(());
    }

    let mut client = LiveClient::builder()
        .key(&api_key)?
        .dataset(&dataset)
        .build()
        .await?;

    let sub = Subscription::builder()
        .schema(Schema::Trades)
        .stype_in(SType::RawSymbol)
        .symbols(symbols.clone())
        .build();
    client.subscribe(&sub).await?;
    client.start().await?;
    info!(?symbols, %dataset, "Live trades subscriber connected");

    tokio::spawn(async move {
        let mut trade_count = 0;
        let mut instrument_to_symbol: std::collections::HashMap<u32, String> = std::collections::HashMap::new();
        
        while let Ok(Some(rec)) = client.next_record().await {
            // Handle symbol mapping messages
            if let Some(mapping) = rec.get::<databento::dbn::SymbolMappingMsg>() {
                let raw_symbol = unsafe {
                    std::ffi::CStr::from_ptr(mapping.stype_out_symbol.as_ptr() as *const i8)
                        .to_string_lossy()
                        .into_owned()
                };
                info!("Symbol mapping received: instrument_id={} -> symbol={}", mapping.hd.instrument_id, raw_symbol);
                instrument_to_symbol.insert(mapping.hd.instrument_id, raw_symbol);
            }
            
            // Handle trade messages
            if let Some(trade) = rec.get::<TradeMsg>() {
                let px = trade.price as f64 / 1_000_000_000.0;
                let inst = trade.hd.instrument_id;
                let size = trade.size;
                
                // Log every trade we receive
                trade_count += 1;
                let symbol_name = instrument_to_symbol.get(&inst)
                    .map(|s| s.as_str())
                    .unwrap_or("UNKNOWN");
                    
                info!(
                    "Live trade #{}: instrument_id={} ({}), price=${:.4}, size={}", 
                    trade_count, inst, symbol_name, px, size
                );
                
                let mut map = state.prices.write().await;
                
                // Store by instrument_id
                let inst_key = format!("INST:{}", inst);
                map.insert(inst_key, LastPrice { price: Some(px), ts_event_ns: Some(trade.hd.ts_event) });
                
                // Store by symbol name if we have the mapping
                if let Some(symbol) = instrument_to_symbol.get(&inst) {
                    map.insert(symbol.clone(), LastPrice { price: Some(px), ts_event_ns: Some(trade.hd.ts_event) });
                }
            }
        }
        info!("Live trades stream ended");
    });

    Ok(())
}
