'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TraderFilter from '@/components/TraderFilter';
import { FaExpand, FaCompress, FaTimes, FaVolumeUp, FaSpinner, FaStop } from 'react-icons/fa';
import { BiCollapse } from 'react-icons/bi';
import { FaSun, FaMoon } from 'react-icons/fa';
import { FaMagnifyingGlass } from 'react-icons/fa6';
import { RiLineChartLine } from 'react-icons/ri';
import Image from 'next/image';
import ChartModal from '@/components/ChartModal';

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
  firstMentionPrice: number | null;
  firstMentionAuthor: string | null;
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false); // Mobile menu state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false); // Collapse state for desktop focus mode
  const [searchFocused, setSearchFocused] = useState(false); // Search focus state
  const [comboSearch, setComboSearch] = useState(''); // Combined ticker/trader search
  const [searchResults, setSearchResults] = useState<{tickers: any[], traders: any[]}>({tickers: [], traders: []});
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedSearchItems, setSelectedSearchItems] = useState<{type: 'ticker' | 'trader', value: string, data?: any}[]>([]);
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
  // Chart modal state
  const [chartModal, setChartModal] = useState<{ isOpen: boolean; symbol: string }>({ isOpen: false, symbol: '' });
  // Audio state
  const [audioState, setAudioState] = useState<{[ticker: string]: 'idle' | 'loading' | 'playing'}>({});
  const [currentAudio, setCurrentAudio] = useState<{ticker: string, audio: HTMLAudioElement} | null>(null);

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
                  const qs = chunk.join(',');
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
          const qs = chunk.join(',');
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
  const updateUrl = (traders: any[], filterText: string, collapsed?: boolean, darkMode?: boolean, dateRange?: string) => {
    const params = new URLSearchParams();
    if (traders.length > 0) {
      params.set('traders', traders.map(t => t.username).join(','));
    }
    if (filterText) {
      params.set('filter', filterText);
    }
    if (collapsed !== undefined) {
      if (collapsed) {
        params.set('expand', 'true');
      } else {
        params.delete('expand');
      }
    }
    if (darkMode !== undefined) {
      if (darkMode) {
        params.set('dark', 'true');
      } else {
        params.delete('dark');
      }
    }
    if (dateRange !== undefined) {
      params.set('range', dateRange);
    }
    
    const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  };

  // Handle trader filter changes
  const handleTradersChange = (traders: any[]) => {
    setSelectedTraders(traders);
    updateUrl(traders, filter, undefined, undefined, dateRange);
  };

  // Handle filter input change
  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFilter(value);
    updateUrl(selectedTraders, value, undefined, undefined, dateRange);
  };

  // Handle expand/collapse toggle
  const toggleExpand = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    localStorage.setItem('hasjuice-isCollapsed', collapsed.toString());
    updateUrl(selectedTraders, filter, collapsed, undefined, dateRange);
  };

  // Handle dark mode toggle
  const toggleDarkMode = (dark: boolean) => {
    setIsDarkMode(dark);
    localStorage.setItem('hasjuice-darkMode', dark.toString());
    updateUrl(selectedTraders, filter, undefined, dark, dateRange);
  };

  // Handle date range change
  const handleDateRangeChange = (range: string) => {
    setDateRange(range);
    localStorage.setItem('hasjuice-dateRange', range);
    updateUrl(selectedTraders, filter, undefined, undefined, range);
    fetchStocks(); // Refetch data with new date range
  };

  // Search for tickers and traders
  const searchCombo = async (query: string) => {
    if (!query.trim()) {
      setSearchResults({tickers: [], traders: []});
      setShowSearchResults(false);
      return;
    }

    try {
      // Search tickers from current stocks
      const tickerMatches = stocks.filter(stock => 
        stock.ticker.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 5);

      // Search traders via API
      const traderResponse = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      const traderData = await traderResponse.json();
      const traderMatches = traderData.users?.slice(0, 5) || [];

      setSearchResults({
        tickers: tickerMatches,
        traders: traderMatches
      });
      setShowSearchResults(true);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults({tickers: [], traders: []});
    }
  };

  // Handle combo search input change
  const handleComboSearchChange = (value: string) => {
    setComboSearch(value);
    if (value.trim()) {
      searchCombo(value);
    } else {
      setShowSearchResults(false);
    }
  };

  // Add search item as chip
  const addSearchItem = (type: 'ticker' | 'trader', value: string, data?: any) => {
    const exists = selectedSearchItems.some(item => item.type === type && item.value === value);
    if (!exists) {
      setSelectedSearchItems(prev => [...prev, {type, value, data}]);
    }
    setComboSearch('');
    setShowSearchResults(false);
    
    // Apply the filter
    if (type === 'trader' && data) {
      const traderExists = selectedTraders.some(t => t.username === data.username);
      if (!traderExists) {
        setSelectedTraders(prev => [...prev, data]);
      }
    }
  };

  // Remove search item chip
  const removeSearchItem = (index: number) => {
    const item = selectedSearchItems[index];
    setSelectedSearchItems(prev => prev.filter((_, i) => i !== index));
    
    // Remove from traders if it's a trader
    if (item.type === 'trader' && item.data) {
      setSelectedTraders(prev => prev.filter(t => t.username !== item.data.username));
    }
  };

  useEffect(() => {
    setMounted(true);
    setLastUpdate(new Date());
    
    // Initialize from localStorage first, then URL parameters
    const savedDarkMode = localStorage.getItem('hasjuice-darkMode');
    const savedDateRange = localStorage.getItem('hasjuice-dateRange');
    const savedIsCollapsed = localStorage.getItem('hasjuice-isCollapsed');
    
    // Set initial values from localStorage
    if (savedDarkMode !== null) {
      setIsDarkMode(savedDarkMode === 'true');
    }
    if (savedDateRange && ['today', 'week', 'month', 'all'].includes(savedDateRange)) {
      setDateRange(savedDateRange);
    }
    if (savedIsCollapsed !== null) {
      setIsCollapsed(savedIsCollapsed === 'true');
    }

    // Initialize from URL parameters (overrides localStorage)
    const urlParams = new URLSearchParams(window.location.search);
    const tradersParam = urlParams.get('traders');
    const filterParam = urlParams.get('filter');
    const expandParam = urlParams.get('expand');
    const darkParam = urlParams.get('dark');
    const rangeParam = urlParams.get('range');
    
    if (filterParam) {
      setFilter(filterParam);
    }
    
    if (expandParam === 'true') {
      setIsCollapsed(true);
      localStorage.setItem('hasjuice-isCollapsed', 'true');
    }
    
    if (darkParam === 'true') {
      setIsDarkMode(true);
      localStorage.setItem('hasjuice-darkMode', 'true');
    } else if (darkParam === 'false') {
      setIsDarkMode(false);
      localStorage.setItem('hasjuice-darkMode', 'false');
    }
    
    if (rangeParam && ['today', 'week', 'month', 'all'].includes(rangeParam)) {
      setDateRange(rangeParam);
      localStorage.setItem('hasjuice-dateRange', rangeParam);
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

  // Combined filtering for both ticker filter and combo search
  const filteredStocks = stocks.filter(stock => {
    const tickerMatch = stock.ticker.toLowerCase().includes(filter.toLowerCase());
    const comboTickerMatch = comboSearch ? stock.ticker.toLowerCase().includes(comboSearch.toLowerCase()) : true;
    return tickerMatch && comboTickerMatch;
  });

  // Color gradient based on mention count
  const getCardColor = (mention_count: number) => {
    if (mention_count >= 20) return 'bg-gradient-to-br from-red-500 to-pink-600';
    if (mention_count >= 10) return 'bg-gradient-to-br from-orange-500 to-red-500';
    if (mention_count >= 5) return 'bg-gradient-to-br from-yellow-500 to-orange-500';
    return 'bg-gradient-to-br from-[#08c0b1] to-[#0891b2]';
  };

  const getHeatLevel = (mention_count: number) => {
    if (mention_count >= 20) return 3;
    if (mention_count >= 10) return 2;
    if (mention_count >= 5) return 1;
    return 0;
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

  const openChart = (symbol: string) => {
    setChartModal({ isOpen: true, symbol });
  };

  const closeChart = () => {
    setChartModal({ isOpen: false, symbol: '' });
  };

  const handleSquawkAudio = async (ticker: string) => {
    const currentState = audioState[ticker] || 'idle';
    
    // If already playing, stop it
    if (currentState === 'playing' && currentAudio?.ticker === ticker) {
      currentAudio.audio.pause();
      setCurrentAudio(null);
      setAudioState(prev => ({ ...prev, [ticker]: 'idle' }));
      return;
    }

    // If another ticker is playing, stop it first
    if (currentAudio) {
      currentAudio.audio.pause();
      setAudioState(prev => ({ ...prev, [currentAudio.ticker]: 'idle' }));
    }

    // Start loading
    setAudioState(prev => ({ ...prev, [ticker]: 'loading' }));
    
    try {
      // Generate squawk report and convert to speech
      const reportResponse = await fetch('/api/squawk-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          traders: selectedTraders.length > 0 ? selectedTraders.map(t => t.username) : undefined,
          range: dateRange,
        }),
      });

      if (!reportResponse.ok) {
        throw new Error('Failed to generate squawk report');
      }

      const reportData = await reportResponse.json();
      
      // Clean the report text for audio
      const cleanText = reportData.report
        .replace(/[$]/g, 'dollar ') // Replace $ with "dollar" for better pronunciation
        .replace(/[•-]/g, '') // Remove bullet points
        .replace(/Key Takeaways:/g, '. Key takeaways.') // Better audio transition
        .replace(/\n\n+/g, '. ') // Replace double newlines with periods
        .replace(/\n/g, ' ') // Replace single newlines with spaces
        .replace(/\s+/g, ' ') // Clean up multiple spaces
        .trim();

      // Convert to speech
      const ttsResponse = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          voice_id: 'pNInz6obpgDQGcFmaJgB' // Adam voice
        }),
      });

      if (!ttsResponse.ok) {
        throw new Error('Failed to generate speech');
      }

      const audioBlob = await ttsResponse.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onplay = () => {
        setAudioState(prev => ({ ...prev, [ticker]: 'playing' }));
      };
      
      audio.onended = () => {
        setAudioState(prev => ({ ...prev, [ticker]: 'idle' }));
        setCurrentAudio(null);
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = () => {
        setAudioState(prev => ({ ...prev, [ticker]: 'idle' }));
        setCurrentAudio(null);
        URL.revokeObjectURL(audioUrl);
      };
      
      setCurrentAudio({ ticker, audio });
      await audio.play();

    } catch (error) {
      console.error('Error with squawk audio:', error);
      setAudioState(prev => ({ ...prev, [ticker]: 'idle' }));
    }
  };

  return (
    <div className={`min-h-screen py-8 ${isDarkMode ? 'bg-[#17191c]' : 'bg-gray-50'}`}>
      <div className={`mx-auto px-4 sm:px-6 lg:px-8 ${isCollapsed ? 'max-w-none' : 'max-w-7xl'}`}>
        {/* Status Bar - Above Header */}
        <div className={`mb-4 ${isCollapsed ? 'hidden sm:hidden' : ''}`}>
          <div className="flex justify-end items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <span className={`text-sm hidden sm:block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {mounted && lastUpdate && (
              <div className={`text-sm hidden sm:block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Last update: {format(lastUpdate, 'HH:mm:ss')}
              </div>
            )}
            {/* Dark Mode Toggle */}
            <button
              onClick={() => toggleDarkMode(!isDarkMode)}
              className={`p-2 rounded-lg transition-colors hidden sm:block ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? (
                <FaSun className="w-4 h-4 text-yellow-400" />
              ) : (
                <FaMoon className="w-4 h-4 text-gray-600" />
              )}
            </button>
            {/* Expand/Collapse Toggle */}
            <button
              className={`p-2 rounded-lg transition-colors hidden sm:block ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              onClick={() => toggleExpand(!isCollapsed)}
              aria-label={isCollapsed ? 'Expand view' : 'Collapse view'}
            >
              {isCollapsed ? (
                <FaExpand className={`w-4 h-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`} />
              ) : (
                <FaCompress className={`w-4 h-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`} />
              )}
            </button>
          </div>
        </div>

        {/* Header */}
        <div className={`mb-6 p-4 sm:p-6 ${isCollapsed ? 'hidden sm:hidden' : ''}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* HasJuice Logo + Lettering */}
              <div className="flex items-center gap-1">
                <Image 
                  src="/images/has-juice-icon.png" 
                  alt="HasJuice Logo" 
                  width={178} 
                  height={232}
                  className="w-12 h-16"
                />
                <Image 
                  src="/images/has-juice-lettering.png" 
                  alt="HasJuice" 
                  width={274} 
                  height={105}
                  className="w-20 h-8"
                />
              </div>
              
              {/* Navigation - Simple text with active states */}
              <div className={`hidden sm:flex items-center gap-6 ml-8 ${searchFocused ? 'opacity-0 pointer-events-none' : 'opacity-100'} transition-opacity duration-200`}>
                <button
                  onClick={() => handleDateRangeChange('today')}
                  className={`text-sm font-medium transition-colors ${
                    dateRange === 'today' 
                      ? 'text-[#57bdb0]' 
                      : isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  today
                </button>
                <button
                  onClick={() => handleDateRangeChange('week')}
                  className={`text-sm font-medium transition-colors ${
                    dateRange === 'week' 
                      ? 'text-[#57bdb0]' 
                      : isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  this week
                </button>
                <button
                  onClick={() => handleDateRangeChange('month')}
                  className={`text-sm font-medium transition-colors ${
                    dateRange === 'month' 
                      ? 'text-[#57bdb0]' 
                      : isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  this month
                </button>
                <button
                  onClick={() => handleDateRangeChange('all')}
                  className={`text-sm font-medium transition-colors ${
                    dateRange === 'all' 
                      ? 'text-[#57bdb0]' 
                      : isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  all-time
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end flex-1">
              {/* Combo Search Bar - Hidden on mobile, expandable on desktop */}
              <div className={`hidden sm:block relative transition-all duration-300 ${searchFocused ? 'w-[600px]' : 'w-64'}`}>
                <div className="relative">
                  <FaMagnifyingGlass className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#17191c]" />
                  <input
                    type="text"
                    value={comboSearch}
                    onChange={(e) => handleComboSearchChange(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={(e) => {
                      // Delay hiding results to allow clicking on them
                      setTimeout(() => {
                        setSearchFocused(false);
                        setShowSearchResults(false);
                      }, 200);
                    }}
                    placeholder="Ticker / Trader"
                    className="w-full pl-4 pr-10 py-2 rounded-full bg-[#58beb1] text-[#17191c] placeholder-[#17191c] focus:outline-none transition-all duration-300"
                  />
                </div>
                
                {/* Search Results Dropdown */}
                {showSearchResults && (searchResults.tickers.length > 0 || searchResults.traders.length > 0) && (
                  <div className={`absolute top-full left-0 right-0 mt-2 rounded-lg shadow-lg z-50 ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
                    {/* Ticker Results */}
                    {searchResults.tickers.length > 0 && (
                      <div className="p-2">
                        <div className={`text-xs font-medium px-2 py-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          Tickers
                        </div>
                        {searchResults.tickers.map((ticker) => (
                          <button
                            key={ticker.ticker}
                            onClick={() => addSearchItem('ticker', ticker.ticker, ticker)}
                            className={`w-full text-left px-3 py-2 rounded-md hover:bg-opacity-10 hover:bg-[#08c0b1] flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                          >
                            <span className="font-bold text-[#08c0b1]">$</span>
                            <span className="font-semibold">{ticker.ticker}</span>
                            <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {ticker.mentionCount} mentions
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {/* Trader Results */}
                    {searchResults.traders.length > 0 && (
                      <div className="p-2">
                        {searchResults.tickers.length > 0 && (
                          <div className={`border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} my-2`}></div>
                        )}
                        <div className={`text-xs font-medium px-2 py-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          Traders
                        </div>
                        {searchResults.traders.map((trader) => (
                          <button
                            key={trader.username}
                            onClick={() => addSearchItem('trader', trader.username, trader)}
                            className={`w-full text-left px-3 py-2 rounded-md hover:bg-opacity-10 hover:bg-[#08c0b1] flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                          >
                            <span className="font-bold text-[#08c0b1]">@</span>
                            {trader.avatar_url ? (
                              <img 
                                src={trader.avatar_url} 
                                alt={trader.display_name || trader.username}
                                className="w-6 h-6 rounded-full"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-[#08c0b1] flex items-center justify-center text-white text-xs font-bold">
                                {(trader.display_name || trader.username).charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="font-semibold">{trader.display_name || trader.username}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Mobile menu button - moved to right */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`sm:hidden p-2 rounded-md ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                aria-label="Toggle menu"
              >
                <svg className={`w-6 h-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Drawer Overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40 sm:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <div
              className={`fixed right-0 top-0 h-full w-80 shadow-lg transform transition-transform duration-300 ease-in-out z-50 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`p-6 border-b ${isDarkMode ? 'border-gray-700 text-white' : 'border-gray-200 text-gray-900'}`}>
                <div className="flex items-center justify-between">
                  <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Filters & Stats</h2>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                  >
                    <svg className={`w-6 h-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                
                {/* Date Range */}
                <div className="mb-6">
                  <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Date Range</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { handleDateRangeChange('today'); setMobileMenuOpen(false); }}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                        dateRange === 'today' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Today
                    </button>
                    <button
                      onClick={() => { handleDateRangeChange('week'); setMobileMenuOpen(false); }}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                        dateRange === 'week' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      This Week
                    </button>
                    <button
                      onClick={() => { handleDateRangeChange('month'); setMobileMenuOpen(false); }}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                        dateRange === 'month' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      This Month
                    </button>
                    <button
                      onClick={() => { handleDateRangeChange('all'); setMobileMenuOpen(false); }}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                        dateRange === 'all' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      All Time
                    </button>
                  </div>
                </div>
                
                {/* Combo Search */}
                <div className="mb-6">
                  <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Search</h3>
                  <div className="relative">
                    <div className={`flex items-center border rounded-lg px-3 py-2 ${isDarkMode ? 'border-gray-600 bg-gray-700' : 'border-gray-300 bg-white'}`}>
                      <FaMagnifyingGlass className={`w-4 h-4 mr-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                      <input
                        type="text"
                        value={comboSearch}
                        onChange={(e) => handleComboSearchChange(e.target.value)}
                        onFocus={() => setShowSearchResults(true)}
                        placeholder="Search tickers or traders..."
                        className={`flex-1 bg-transparent outline-none ${isDarkMode ? 'text-white placeholder-gray-400' : 'text-gray-900 placeholder-gray-500'}`}
                      />
                    </div>

                    {/* Search Results Dropdown */}
                    {showSearchResults && comboSearch && (
                      <div className={`absolute top-full left-0 right-0 mt-1 border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto ${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'}`}>
                        {[...searchResults.tickers, ...searchResults.traders].map((result, index) => (
                          <button
                            key={`${result.type}-${result.value}`}
                            onClick={() => {
                              addSearchItem(result.type, result.value, result.data);
                              setMobileMenuOpen(false);
                            }}
                            className={`w-full px-4 py-3 text-left hover:bg-opacity-50 transition-colors flex items-center gap-3 ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                          >
                            {result.type === 'ticker' ? (
                              <>
                                <span className="font-bold text-[#08c0b1]">$</span>
                                <span className="font-semibold">{result.value}</span>
                              </>
                            ) : (
                              <>
                                {result.data?.avatar_url ? (
                                  <img 
                                    src={result.data.avatar_url} 
                                    alt={result.data.display_name || result.data.username}
                                    className="w-8 h-8 rounded-full"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center">
                                    <span className="text-white text-sm font-medium">
                                      {(result.data?.display_name || result.data?.username || result.value || '?').charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                )}
                                <span className="font-medium">{result.data?.display_name || result.data?.username || result.value}</span>
                              </>
                            )}
                          </button>
                        ))}
                        {searchResults.tickers.length === 0 && searchResults.traders.length === 0 && (
                          <div className={`px-4 py-3 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            No results found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Search Filter Chips - Below Header */}
        {(filter || selectedTraders.length > 0 || selectedSearchItems.length > 0) && (
          <div className={`mb-6 ${isCollapsed ? 'hidden sm:hidden' : ''}`}>
            <div className="flex flex-wrap gap-2">
              {/* Ticker Filter Chip */}
              {filter && (
                <div className={`inline-flex items-center gap-3 px-4 py-2 rounded-full ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                  <span className="text-base">Ticker: {filter}</span>
                  <button
                    onClick={() => setFilter('')}
                    className={`hover:bg-gray-600 rounded-full p-1 ml-1 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <FaTimes className="w-3 h-3" />
                  </button>
                </div>
              )}
              
              {/* Selected Search Items Chips */}
              {selectedSearchItems.map((item, index) => (
                <div key={`${item.type}-${item.value}`} className={`inline-flex items-center gap-3 px-4 py-2 rounded-full ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                  {item.type === 'ticker' ? (
                    <>
                      <span className="font-bold text-[#08c0b1] text-base">$</span>
                      <span className="font-semibold text-base">{item.value}</span>
                    </>
                  ) : (
                    <>
                      {item.data?.avatar_url ? (
                        <img 
                          src={item.data.avatar_url} 
                          alt={item.data.display_name || item.data.username}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#08c0b1] flex items-center justify-center text-white text-sm font-bold">
                          {(item.data?.display_name || item.value).charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium text-base">{item.data?.display_name || item.value}</span>
                    </>
                  )}
                  <button
                    onClick={() => removeSearchItem(index)}
                    className={`hover:bg-gray-600 rounded-full p-1 ml-1 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <FaTimes className="w-3 h-3" />
                  </button>
                </div>
              ))}
              
              {/* Legacy Selected Traders Chips (for traders not added via combo search) */}
              {selectedTraders.filter(trader => 
                !selectedSearchItems.some(item => item.type === 'trader' && item.data?.username === trader.username)
              ).map((trader, index) => (
                <div key={trader.username} className={`inline-flex items-center gap-3 px-4 py-2 rounded-full ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                  {trader.avatar_url ? (
                    <img 
                      src={trader.avatar_url} 
                      alt={trader.display_name || trader.username}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#08c0b1] flex items-center justify-center text-white text-sm font-bold">
                      {(trader.display_name || trader.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-base font-medium">{trader.display_name || trader.username}</span>
                  <button
                    onClick={() => handleTradersChange(selectedTraders.filter((_, i) => i !== index))}
                    className={`hover:bg-gray-600 rounded-full p-1 ml-1 ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <FaTimes className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Collapse Button - Absolute positioned when collapsed */}
        {isCollapsed && (
          <button
            className={`fixed top-4 right-4 z-50 p-2 shadow-lg rounded-lg transition-colors hidden sm:block ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-white hover:bg-gray-100'}`}
            aria-label="Collapse"
            onClick={() => toggleExpand(false)}
          >
            <BiCollapse className={`w-4 h-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`} />
          </button>
        )}

        {/* Stock Cards Grid */}
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className={`animate-spin rounded-full h-12 w-12 border-b-2 ${isDarkMode ? 'border-white' : 'border-gray-900'}`}></div>
          </div>
        ) : (
          <div className={`grid gap-4 ${isCollapsed ? 'grid-cols-[repeat(auto-fit,minmax(280px,1fr))]' : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
            {filteredStocks.map((stock) => (
              <div
                key={stock.ticker}
                className="relative overflow-hidden rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 cursor-pointer"
                onClick={() => {
                  const params = new URLSearchParams();
                  if (selectedTraders.length > 0) {
                    params.set('traders', selectedTraders.map(t => t.username).join(','));
                  }
                  if (isDarkMode) {
                    params.set('dark', 'true');
                  }
                  if (dateRange !== 'all') {
                    params.set('range', dateRange);
                  }
                  const queryString = params.toString() ? `?${params.toString()}` : '';
                  router.push(`/ticker/${stock.ticker}${queryString}`);
                }}
              >
                {/* Card Background with Gradient */}
                <div className={`${getCardColor(stock.mentionCount)} p-6 text-white`}>
                  {/* Ticker Symbol with Heat Indicator */}
                  <div className="flex items-center mb-2">
                    <div className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight">
                      ${stock.ticker}
                    </div>
                    <div className="flex items-center -space-x-1 ml-auto mr-[-15px]">
                      {getHeatLevel(stock.mentionCount) > 0 ? (
                        // Fire cards: show juice box icons
                        Array.from({ length: getHeatLevel(stock.mentionCount) }, (_, i) => (
                          <Image
                            key={i}
                            src="/images/juice.png"
                            alt="juice"
                            width={32}
                            height={32}
                            className=""
                          />
                        ))
                      ) : (
                        // Blue cards: show look icon
                        <Image
                          src="/images/look.png"
                          alt="look"
                          width={32}
                          height={32}
                          className=""
                        />
                      )}
                    </div>
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
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        className="p-1 rounded hover:bg-white/10 transition"
                        title={`Listen to ${stock.ticker} squawk report`}
                        aria-label={`Listen to ${stock.ticker} squawk report`}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSquawkAudio(stock.ticker); }}
                        disabled={audioState[stock.ticker] === 'loading'}
                      >
                        {audioState[stock.ticker] === 'loading' ? (
                          <FaSpinner className="h-4 w-4 animate-spin" />
                        ) : audioState[stock.ticker] === 'playing' ? (
                          <FaStop className="h-4 w-4" />
                        ) : (
                          <FaVolumeUp className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        className="p-1 rounded hover:bg-white/10 transition"
                        title={`View ${stock.ticker} chart`}
                        aria-label={`View ${stock.ticker} chart`}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openChart(stock.ticker); }}
                      >
                        <RiLineChartLine className="h-4 w-4" />
                      </button>
                      <button
                        className={`p-1 rounded hover:bg-white/10 transition ${refreshing.has(stock.ticker.toUpperCase()) ? 'opacity-60 cursor-wait' : ''}`}
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
                  </div>
                  
                  {/* First Mention Info */}
                  {stock.firstMention && (
                    <div className="border-t border-white/20 pt-3 space-y-1">
                      {/* First mention label and price on same line */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs opacity-75">First mention</span>
                        {stock.firstMentionPrice && (
                          <span className="text-sm font-bold text-white">
                            ${stock.firstMentionPrice.toFixed(2)}
                          </span>
                        )}
                      </div>
                      {/* Time and By - Limited to 30 chars */}
                      <div className="text-xs opacity-90 truncate">
                        {(() => {
                          const time = format(new Date(stock.firstMention), 'h:mmaaa');
                          const author = stock.firstMentionAuthor ? ` by @${stock.firstMentionAuthor}` : '';
                          const fullText = `${time}${author}`;
                          return fullText.length > 30 ? fullText.substring(0, 30) + '...' : fullText;
                        })()}
                      </div>
                      <div className="text-xs opacity-75">
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
            <p className={`text-lg ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {filter ? `No tickers found matching "${filter}"` : 'No stock tickers detected yet'}
            </p>
            <p className={`${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>
              {connected ? 'Waiting for new messages...' : 'Connecting to live feed...'}
            </p>
          </div>
        )}
      </div>
      
      {/* Chart Modal */}
      <ChartModal
        symbol={chartModal.symbol}
        isOpen={chartModal.isOpen}
        onClose={closeChart}
        isDarkMode={isDarkMode}
      />
    </div>
  );
}
