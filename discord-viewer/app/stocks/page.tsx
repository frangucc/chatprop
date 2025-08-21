'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TraderFilter from '@/components/TraderFilter';

interface Stock {
  ticker: string;
  exchange: string;
  mentionCount: number;
  uniqueAuthors: number;
  avgConfidence: number;
  firstMention: string;
  lastMention: string;
  sampleMentions: string[];
  mentionedByTrader: boolean;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  momentum: string;
  // Legacy fields for compatibility
  mention_count?: number;
  detection_confidence?: number;
  ai_confidence?: number;
  first_mention_timestamp?: string;
  first_mention_author?: string;
  is_genuine_stock?: boolean;
}

interface LivePrice {
  symbol: string;
  price: number | null;
  ts_event_ns: number | null;
}

export default function StocksPage() {
  const router = useRouter();
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchStatus, setBatchStatus] = useState<any>(null);
  const [selectedTraders, setSelectedTraders] = useState<any[]>([]);
  const [urlInitialized, setUrlInitialized] = useState(false);
  const [dateRange, setDateRange] = useState('today'); // Add date range state
  // Store price and last event timestamp per symbol
  const [livePrices, setLivePrices] = useState<Map<string, { price: number; ts: number | null }>>(new Map());
  // Tick every second to update 'seconds ago' counters
  const [nowTick, setNowTick] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // Track consecutive nulls per symbol for backfill logic
  const missingCountsRef = React.useRef<Map<string, number>>(new Map());
  const backfillingRef = React.useRef<Set<string>>(new Set());
  // Track manual refresh in-flight state per ticker
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [refreshingInfo, setRefreshingInfo] = useState<Map<string, { started: number; lastTs: number | null }>>(new Map());
  // Priority boost for next poll cycles when user manually refreshes
  const priorityBoostRef = React.useRef<Map<string, number>>(new Map());

  const refreshTicker = async (symbol: string) => {
    const key = symbol.toUpperCase();
    const currentEntry = livePrices.get(key) || null;
    const currentTs = currentEntry?.ts ?? null;
    const currentPrice = currentEntry?.price ?? null;
    console.log(`[refresh] start ${key} prev price=${currentPrice ?? '∅'} prev ts=${currentTs ?? '∅'}`);
    setRefreshing(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setRefreshingInfo(prev => {
      const next = new Map(prev);
      next.set(key, { started: Date.now(), lastTs: currentTs });
      return next;
    });
    try {
      // Ensure backend is subscribed for this symbol immediately
      fetch('/api/live/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: [key] })
      }).catch(() => {});

      // Boost priority for the next few polls so it appears in the first chunk
      const boosts = priorityBoostRef.current;
      boosts.set(key, 5);

      const qs = encodeURIComponent(key);
      const tryFetch = async (): Promise<LivePrice | null> => {
        try {
          const r = await fetch(`/api/live/prices?symbols=${qs}`);
          if (!r.ok) return null;
          const arr: LivePrice[] = await r.json();
          const item = arr.find(p => p.symbol.toUpperCase() === key) || null;
          if (item) {
            console.log(`[refresh] fetch ${key} got price=${item.price ?? '∅'} ts=${item.ts_event_ns ?? '∅'}`);
          } else {
            console.log(`[refresh] fetch ${key} returned no item`);
          }
          return item;
        } catch { return null; }
      };

      const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
      const applyAndMaybeClear = (item: LivePrice | null): boolean => {
        if (!item || item.price === null) return false;
        const ts = item.ts_event_ns || null;
        setLivePrices(prev => {
          const next = new Map(prev);
          next.set(key, { price: item.price as number, ts });
          return next;
        });
        if ((item.price !== currentPrice) || (ts && ts !== currentTs)) {
          const reason = (item.price !== currentPrice)
            ? 'price_change'
            : 'ts_change';
          console.log(`[refresh] clear spinner ${key} due to ${reason}: ${currentPrice ?? '∅'}@${currentTs ?? '∅'} -> ${item.price}@${ts ?? '∅'}`);
          setRefreshing(prev => { const n = new Set(prev); n.delete(key); return n; });
          setRefreshingInfo(prev => { const n = new Map(prev); n.delete(key); return n; });
          return true;
        }
        return false;
      };

      let gotNew = applyAndMaybeClear(await tryFetch());
      if (!gotNew) {
        await sleep(200);
        gotNew = applyAndMaybeClear(await tryFetch());
      }
      if (!gotNew) {
        await sleep(200);
        gotNew = applyAndMaybeClear(await tryFetch());
      }
      // Removed historical API fallback - only use live WebSocket data
      // if (!gotNew) {
      //   const offsets = [0, -15, -60];
      //   for (const off of offsets) {
      //     try {
      //       console.log(`[refresh] backfill ${key} at offset ${off} min`);
      //       await fetch('/api/live/ingest_hist', {
      //         method: 'POST',
      //         headers: { 'Content-Type': 'application/json' },
      //         body: JSON.stringify({ symbols: [key], timestamp: new Date(Date.now() + off * 60 * 1000).toISOString() })
      //       });
      //     } catch {}
      //     await sleep(250);
      //     gotNew = applyAndMaybeClear(await tryFetch());
      //     if (gotNew) break;
      //   }
      // }
      if (!gotNew) {
        await sleep(800);
        gotNew = applyAndMaybeClear(await tryFetch());
      }
    } catch (e) {
      console.warn('manual refresh failed for', symbol, e);
    } finally {
      // Safety timeout: stop spinner after 6s if no update observed via polling
      setTimeout(() => {
        if (refreshing.has(key)) {
          console.log(`[refresh] safety-timeout clearing spinner for ${key}`);
        }
        setRefreshing(prev => { const n = new Set(prev); n.delete(key); return n; });
        setRefreshingInfo(prev => { const n = new Map(prev); n.delete(key); return n; });
      }, 6000);
    }
  };

  // Helper function to deduplicate stocks by ticker
  const deduplicateStocks = (stocks: Stock[]) => {
    const stockMap = new Map<string, Stock>();
    stocks.forEach(stock => {
      const existing = stockMap.get(stock.ticker);
      if (!existing || stock.mentionCount > (existing.mentionCount || 0)) {
        stockMap.set(stock.ticker, stock);
      }
    });
    return Array.from(stockMap.values());
  };

  const fetchStocks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedTraders.length > 0) {
        params.set('traders', selectedTraders.map(t => t.username).join(','));
      }
      params.set('dateRange', dateRange);
      
      const response = await fetch(`/api/stocks-v3?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        const dedupedData = deduplicateStocks(data.stocks || []);
        setStocks(dedupedData);
        // Show UI immediately; run price work in background
        setLoading(false);

        // Fetch live prices for all tickers (ordered by mention count) in background
        if (dedupedData.length > 0) {
          (async () => {
            const ordered = dedupedData
              .sort((a, b) => b.mentionCount - a.mentionCount)
              .map(s => s.ticker.toUpperCase());
            console.log(`Fetching live prices for ${dedupedData.length} tickers (ordered by mentions):`);
            console.log(`Top 10: ${dedupedData.slice(0, 10).map(s => `${s.ticker}(${s.mentionCount})`).join(', ')}`);

            try {
              // Subscribe in small batches
              const symbolsArr = ordered;
              const subBatch = 15;
              const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
              for (let i = 0; i < symbolsArr.length; i += subBatch) {
                const batch = symbolsArr.slice(i, i + subBatch);
                fetch('/api/live/subscribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ symbols: batch })
                }).catch(err => console.warn('subscribe batch failed:', err));
                await delay(120);
              }

              // Initial price pull: prioritize smaller set for faster first paint
              const prioritized = ordered.slice(0, 30);
              const chunkedFetch = async (symbols: string[], chunkSize = 10, retry = 1) => {
                const chunks: string[][] = [];
                for (let i = 0; i < symbols.length; i += chunkSize) {
                  chunks.push(symbols.slice(i, i + chunkSize));
                }
                const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
                const results: LivePrice[] = [];
                for (let idx = 0; idx < chunks.length; idx++) {
                  const chunk = chunks[idx];
                  const qs = encodeURIComponent(chunk.join(','));
                  let attempt = 0;
                  while (true) {
                    try {
                      const res = await fetch(`/api/live/prices?symbols=${qs}`);
                      if (res.ok) {
                        const data: LivePrice[] = await res.json();
                        results.push(...data);
                        break;
                      } else {
                        if (attempt < retry) {
                          attempt++;
                          await delay(200);
                          continue;
                        }
                        console.warn(`prices chunk ${idx + 1}/${chunks.length} failed:`, res.status);
                        break;
                      }
                    } catch (e) {
                      if (attempt < retry) {
                        attempt++;
                        await delay(200);
                        continue;
                      }
                      console.warn(`prices chunk ${idx + 1}/${chunks.length} error:`, e);
                      break;
                    }
                  }
                  await delay(80);
                }
                return results;
              };

              const prices = await chunkedFetch(prioritized, 10, 1);
              const priceMap = new Map<string, { price: number; ts: number | null }>();
              let priceCount = 0;
              prices.forEach(p => {
                if (p.price !== null) {
                  priceMap.set(p.symbol, { price: p.price as number, ts: p.ts_event_ns || null });
                  priceCount++;
                }
              });
              setLivePrices(priceMap);
              console.log(`Received ${priceCount} live prices out of ${prices.length} tickers`);
              if (priceCount > 0) {
                console.log('Sample prices:', Array.from(priceMap.entries()).slice(0, 5));
              }
            } catch (error) {
              console.error('Error fetching live prices:', error);
            }
          })();
        }
      }
    } catch (error) {
      console.error('Error fetching stocks:', error);
    } finally {
      // loading is turned off earlier after stocks set; keep as safety when response not ok
      setLoading(false);
    }
  };

  // Auto refresh prices every 2 seconds
  useEffect(() => {
    if (stocks.length === 0) return;
    const sorted = [...stocks].sort((a, b) => b.mentionCount - a.mentionCount);
    const baseSymbols = sorted.map(s => s.ticker.toUpperCase());
    // Apply priority boosts (move boosted to front, de-dupe) then cap to 60
    const boosts = priorityBoostRef.current;
    const boostedFront: string[] = [];
    baseSymbols.forEach(sym => {
      if (boosts.has(sym) && boostedFront.indexOf(sym) === -1) boostedFront.push(sym);
    });
    const rest = baseSymbols.filter(sym => boostedFront.indexOf(sym) === -1);
    const symbols = [...boostedFront, ...rest];
    // decrement boosts each cycle
    if (boosts.size > 0) {
      const toDelete: string[] = [];
      boosts.forEach((cnt, sym) => {
        const next = cnt - 1;
        if (next <= 0) toDelete.push(sym); else boosts.set(sym, next);
      });
      toDelete.forEach(sym => boosts.delete(sym));
    }
    // Prioritize top 60 on each poll to surface most-mentioned first
    const prioritized = symbols.slice(0, 60);
    const query = prioritized.join(',');
    
    // Subscribe to all symbols first
    const subscribeToSymbols = async () => {
      try {
        const batchSize = 15;
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
        for (let i = 0; i < symbols.length; i += batchSize) {
          const batch = symbols.slice(i, i + batchSize);
          await fetch('/api/live/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols: batch })
          }).catch(err => console.warn('subscribe batch failed:', err));
          await delay(200);
        }
        console.log(`Subscribed in ${Math.ceil(symbols.length / batchSize)} batches`);
      } catch (e) {
        console.warn('Failed to subscribe to symbols:', e);
      }
    };
    
    subscribeToSymbols();

    const fetchLoop = async () => {
      try {
        const symbolsArr = prioritized;
        const chunkSize = 15;
        const chunks: string[][] = [];
        for (let i = 0; i < symbolsArr.length; i += chunkSize) {
          chunks.push(symbolsArr.slice(i, i + chunkSize));
        }
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
        const aggregate: LivePrice[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const qs = encodeURIComponent(chunk.join(','));
          try {
            const res = await fetch(`/api/live/prices?symbols=${qs}`);
            if (res.ok) {
              const data: LivePrice[] = await res.json();
              aggregate.push(...data);
            } else {
              console.warn(`[poll] chunk ${i + 1}/${chunks.length} failed:`, res.status);
            }
          } catch (e) {
            console.warn(`poll chunk ${i + 1}/${chunks.length} error:`, e);
          }
          await delay(150);
        }
        // Merge into existing map so we don't drop unpolled symbols
        const priceMap = new Map<string, { price: number; ts: number | null }>(livePrices);
        let priceCount = 0;
        // build maps and track null counts for backfill
        const missingCounts = missingCountsRef.current;
        const backfilling = backfillingRef.current;
        const nowIso = new Date();
        aggregate.forEach(p => {
          if (p.price !== null) {
            priceMap.set(p.symbol, { price: p.price as number, ts: p.ts_event_ns || null });
            priceCount++;
            // reset missing count on update
            missingCounts.delete(p.symbol);
          } else {
            const curr = missingCounts.get(p.symbol) || 0;
            const next = curr + 1;
            missingCounts.set(p.symbol, next);
            // Disabled historical backfill - only use live WebSocket data
            // if (next >= 3 && !backfilling.has(p.symbol)) {
            //   backfilling.add(p.symbol);
            //   (async () => {
            //     const offsetsMin = [0, -15, -60, -360, -1560]; // now, 15m, 60m, 6h, 26h
            //     for (const off of offsetsMin) {
            //       try {
            //         const ts = new Date(Date.now() + off * 60 * 1000).toISOString();
            //         const resp = await fetch('/api/live/ingest_hist', {
            //           method: 'POST',
            //           headers: { 'Content-Type': 'application/json' },
            //           body: JSON.stringify({ symbols: [p.symbol], timestamp: ts })
            //         });
            //         if (resp.ok) {
            //           break; // seeded; next poll should pick it up
            //         }
            //       } catch (_) {}
            //     }
            //     backfilling.delete(p.symbol);
            //   })();
            // }
          }
        });
        // If manual refresh is active, clear spinner when ts changes
        if (refreshing.size > 0 && refreshingInfo.size > 0) {
          const toClear: string[] = [];
          refreshingInfo.forEach((info, sym) => {
            const latest = priceMap.get(sym)?.ts ?? null;
            if (latest !== undefined && latest !== info.lastTs && refreshing.has(sym)) {
              toClear.push(sym);
            }
          });
          if (toClear.length > 0) {
            setRefreshing(prev => { const n = new Set(prev); toClear.forEach(s => n.delete(s)); return n; });
            setRefreshingInfo(prev => { const n = new Map(prev); toClear.forEach(s => n.delete(s)); return n; });
          }
        }
        setLivePrices(priceMap);
        if (priceCount > 0) {
          console.log(`[poll] ${priceCount}/${aggregate.length} live prices`, Array.from(priceMap.entries()).slice(0, 3));
        }
      } catch (e) {
        console.warn('poll prices error:', e);
      }
    };

    // kick off immediately and then every 2s
    fetchLoop();
    const id = setInterval(fetchLoop, 2000);
    return () => clearInterval(id);
  }, [stocks]);

  // Update URL parameters
  const updateUrl = (traders: any[], filterText: string) => {
    const params = new URLSearchParams();
    if (traders.length > 0) {
      params.set('traders', traders.map(t => t.username).join(','));
    }
    if (filterText) {
      params.set('filter', filterText);
    }
    
    const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  };

  // Handle trader filter changes
  const handleTradersChange = (traders: any[]) => {
    setSelectedTraders(traders);
    updateUrl(traders, filter);
  };

  // Handle filter input change
  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFilter(value);
    updateUrl(selectedTraders, value);
  };

  useEffect(() => {
    setMounted(true);
    setLastUpdate(new Date());
    
    // Fetch initial data from the new API with date range
    fetchStocks();

    // Initialize from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const url = new URL('/api/stocks-v2', window.location.origin);
    const tradersParam = urlParams.get('traders');
    const filterParam = urlParams.get('filter');
    
    if (filterParam) {
      setFilter(filterParam);
    }
    
    if (tradersParam) {
      // Fetch trader details for the usernames in the URL
      const initializeTradersFromUrl = async () => {
        const traderUsernames = tradersParam.split(',').filter(Boolean);
        if (traderUsernames.length > 0) {
          try {
            // Fetch trader details for each username
            const traderPromises = traderUsernames.map(async (username) => {
              const response = await fetch(`/api/users/search?q=${encodeURIComponent(username)}`);
              if (response.ok) {
                const users = await response.json();
                const trader = users.find((u: any) => u.username === username);
                return trader || { 
                  username, 
                  nickname: username, 
                  avatar: null,
                  stocksMentioned: 0,
                  lastActivity: null
                };
              }
              return { 
                username, 
                nickname: username, 
                avatar: null,
                stocksMentioned: 0,
                lastActivity: null
              };
            });
            
            const tradersFromUrl = await Promise.all(traderPromises);
            setSelectedTraders(tradersFromUrl);
          } catch (error) {
            console.error('Error fetching trader details:', error);
            // Fallback to basic trader objects
            const tradersFromUrl = traderUsernames.map(username => ({
              username,
              nickname: username,
              avatar: null,
              stocksMentioned: 0,
              lastActivity: null
            }));
            setSelectedTraders(tradersFromUrl);
          }
        }
      };
      
      initializeTradersFromUrl();
    }
    
    setUrlInitialized(true);

    // Setup WebSocket connection - connect directly to our custom WebSocket server
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        // Skip initial_tickers from WebSocket - we use the new API with date filtering now
        if (message.type === 'initial_tickers') {
          // Ignore initial tickers from WebSocket, we'll use our API
          console.log('Ignoring WebSocket initial tickers, using API with date range');
          return;
        }
        
        if (message.type === 'ticker_update') {
          // Only handle real-time updates for new tickers
          setStocks(prevStocks => {
            const existingIndex = prevStocks.findIndex(s => s.ticker === message.data.ticker);
            if (existingIndex >= 0) {
              const updated = [...prevStocks];
              updated[existingIndex] = message.data;
              return deduplicateStocks(updated);
            } else {
              const newStocks = [...prevStocks, message.data];
              return deduplicateStocks(newStocks);
            }
          });
          setLastUpdate(new Date());
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnected(false);
    };

    return () => {
      ws.close();
    };
  }, []);

  // Refetch stocks when traders or date range change
  useEffect(() => {
    if (mounted && urlInitialized) {
      fetchStocks();
    }
  }, [selectedTraders, dateRange, mounted, urlInitialized]);

  const filteredStocks = stocks.filter(stock => 
    stock.ticker.toLowerCase().includes(filter.toLowerCase())
  );

  // Color gradient based on mention count
  const getCardColor = (mention_count: number) => {
    if (mention_count >= 20) return 'bg-gradient-to-br from-red-500 to-pink-600';
    if (mention_count >= 10) return 'bg-gradient-to-br from-orange-500 to-red-500';
    if (mention_count >= 5) return 'bg-gradient-to-br from-yellow-500 to-orange-500';
    return 'bg-gradient-to-br from-blue-500 to-indigo-600';
  };

  const getHeatLevel = (mention_count: number) => {
    if (mention_count >= 20) return '🔥🔥🔥';
    if (mention_count >= 10) return '🔥🔥';
    if (mention_count >= 5) return '🔥';
    return '';
  };



  const getConfidenceColor = (confidence: number) => {
    return 'text-white';
  };

  // Price formatter: truncate to 2 decimals (no rounding)
  const formatPriceTrunc2 = (p: number) => {
    const truncated = Math.floor(p * 100) / 100;
    return truncated.toFixed(2);
  };

  // Handle batch processing
  const startBatchProcess = async () => {
    if (batchProcessing) return;
    
    setBatchProcessing(true);
    try {
      const response = await fetch('/api/batch-process', {
        method: 'POST'
      });
      
      if (response.ok) {
        const data = await response.json();
        setBatchStatus(data.status);
        
        // Poll for status updates
        const pollInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch('/api/batch-process');
            if (statusResponse.ok) {
              const statusData = await statusResponse.json();
              setBatchStatus(statusData.status);
              
              if (!statusData.status.running) {
                clearInterval(pollInterval);
                setBatchProcessing(false);
              }
            }
          } catch (error) {
            console.error('Error polling batch status:', error);
          }
        }, 2000);
        
      } else {
        const error = await response.json();
        console.error('Failed to start batch process:', error);
        setBatchProcessing(false);
      }
    } catch (error) {
      console.error('Error starting batch process:', error);
      setBatchProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="bg-white shadow-sm rounded-lg mb-6 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                Stock Ticker Monitor
              </h1>
              <p className="text-sm sm:text-base text-gray-600">
                Real-time ticker extraction from Discord messages
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                <span className="text-gray-600">
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              {mounted && lastUpdate && (
                <div className="text-sm text-gray-500">
                  Last update: {format(lastUpdate, 'HH:mm:ss')}
                </div>
              )}
            </div>
          </div>
          
          {/* Date Range Selector */}
          <div className="flex flex-wrap gap-2 mb-4 mt-4">
            <button
              onClick={() => setDateRange('today')}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 text-sm sm:text-base rounded-lg transition-colors ${
                dateRange === 'today' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateRange('week')}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 text-sm sm:text-base rounded-lg transition-colors ${
                dateRange === 'week' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              This Week
            </button>
            <button
              onClick={() => setDateRange('month')}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 text-sm sm:text-base rounded-lg transition-colors ${
                dateRange === 'month' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setDateRange('all')}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 text-sm sm:text-base rounded-lg transition-colors ${
                dateRange === 'all' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              All Time
            </button>
          </div>
          
          {/* Filter */}
          <input
            type="text"
            value={filter}
            onChange={handleFilterChange}
            placeholder="Filter tickers..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />

          {/* Trader Filter */}
          <TraderFilter
            selectedTraders={selectedTraders}
            onTradersChange={handleTradersChange}
            className="mt-4"
          />
          
          {/* Stats */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="text-sm text-blue-600 font-medium">Total Tickers</p>
              <p className="text-2xl font-bold text-blue-900">{stocks.length}</p>
            </div>
            <div className="bg-green-50 p-3 rounded-lg">
              <p className="text-sm text-green-600 font-medium">Most Mentioned</p>
              <p className="text-2xl font-bold text-green-900">
                {stocks[0]?.ticker || '-'}
              </p>
            </div>
            <div className="bg-purple-50 p-3 rounded-lg">
              <p className="text-sm text-purple-600 font-medium">Highest Count</p>
              <p className="text-2xl font-bold text-purple-900">
                {stocks[0]?.mention_count || 0}
              </p>
            </div>
            <div className="bg-orange-50 p-3 rounded-lg">
              <p className="text-sm text-orange-800 font-medium">Hot Tickers (10+)</p>
              <p className="text-2xl font-bold text-orange-900">
                {stocks.filter(s => s.mentionCount >= 10).length}
              </p>
            </div>
          </div>
        </div>

        {/* Stock Cards Grid */}
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredStocks.map((stock) => (
              <div
                key={stock.ticker}
                className="relative overflow-hidden rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 cursor-pointer"
                onClick={() => {
                  const tradersParam = selectedTraders.length > 0 
                    ? `?traders=${selectedTraders.map(t => t.username).join(',')}` 
                    : '';
                  router.push(`/ticker/${stock.ticker}${tradersParam}`);
                }}
              >
                {/* Card Background with Gradient */}
                <div className={`${getCardColor(stock.mentionCount)} p-6 text-white`}>
                  {/* Heat Indicator */}
                  <div className="absolute top-2 right-2 text-2xl">
                    {getHeatLevel(stock.mentionCount)}
                  </div>
                  
                  {/* Ticker Symbol */}
                  <div className="text-3xl sm:text-4xl md:text-5xl font-black mb-2 tracking-tight">
                    ${stock.ticker}
                  </div>
                  
                  {/* Mention Count */}
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-2xl sm:text-3xl font-bold">{stock.mentionCount}</span>
                    <span className="text-sm opacity-90">
                      mention{stock.mentionCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  {/* Live Price with manual refresh */}
                  <div className="flex items-center mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs opacity-75">Last:</span>
                      <span className="text-lg font-bold">
                        {livePrices.has(stock.ticker.toUpperCase()) 
                          ? `$${formatPriceTrunc2(livePrices.get(stock.ticker.toUpperCase())!.price)}`
                          : '-'}
                      </span>
                      {livePrices.has(stock.ticker.toUpperCase()) && (
                        <span className="text-xs opacity-75">
                          {(() => {
                            const entry = livePrices.get(stock.ticker.toUpperCase())!;
                            if (!entry.ts) return '';
                            const secs = Math.max(0, Math.floor((Date.now() - entry.ts / 1_000_000) / 1000));
                            return `${secs}s ago`;
                          })()}
                        </span>
                      )}
                    </div>
                    <button
                      className={`ml-auto p-1 rounded hover:bg-white/10 transition ${refreshing.has(stock.ticker.toUpperCase()) ? 'opacity-60 cursor-wait' : ''}`}
                      title={`Refresh ${stock.ticker}`}
                      aria-label={`Refresh ${stock.ticker}`}
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); refreshTicker(stock.ticker); }}
                      disabled={refreshing.has(stock.ticker.toUpperCase())}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`h-4 w-4 ${refreshing.has(stock.ticker.toUpperCase()) ? 'animate-spin' : ''}`}
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
                        <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* First Mention Info */}
                  {stock.firstMention && (
                    <div className="border-t border-white/20 pt-3 space-y-2">
                      <div className="text-xs opacity-75">First mention</div>
                      <div className="text-sm font-medium">
                        {format(new Date(stock.firstMention), 'h:mmaaa')} CST
                      </div>
                      <div className="text-xs opacity-90">
                        {stock.uniqueAuthors} unique author{stock.uniqueAuthors !== 1 ? 's' : ''}
                      </div>
                    </div>
                  )}
                </div>
                
              </div>
            ))}
          </div>
        )}
        
        {/* Empty State */}
        {!loading && filteredStocks.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-gray-500 text-lg">
              {filter ? `No tickers found matching "${filter}"` : 'No stock tickers detected yet'}
            </p>
            <p className="text-gray-400 text-sm mt-2">
              {connected ? 'Waiting for new messages...' : 'Connecting to live feed...'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
