'use client';

import { useState, useEffect } from 'react';
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
  const [livePrices, setLivePrices] = useState<Map<string, number>>(new Map());

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
        
        // Fetch live prices for all tickers (ordered by mention count)
        if (dedupedData.length > 0) {
          const ordered = dedupedData
            .sort((a, b) => b.mentionCount - a.mentionCount)
            .map(s => s.ticker.toUpperCase());
          const tickers = ordered.join(',');
          
          console.log(`Fetching live prices for ${dedupedData.length} tickers (ordered by mentions):`);
          console.log(`Top 10: ${dedupedData.slice(0, 10).map(s => `${s.ticker}(${s.mentionCount})`).join(', ')}`);

          try {
            // Subscribe top tickers in batches to avoid overwhelming backend
            const symbolsArr = ordered;
            const batchSize = 20;
            const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
            const batches: string[][] = [];
            for (let i = 0; i < symbolsArr.length; i += batchSize) {
              batches.push(symbolsArr.slice(i, i + batchSize));
            }
            (async () => {
              for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                try {
                  await fetch('/api/live/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbols: batch })
                  });
                } catch (err) {
                  console.warn(`subscribe batch ${i + 1}/${batches.length} failed:`, err);
                }
                // brief pause to let backend establish subscriptions
                await delay(150);
              }
            })();

            // Kick off a background historical ingest to seed last prices (non-blocking)
            // Uses current timestamp by default on the API side; safe to ignore result.
            fetch('/api/live/ingest_hist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbols: symbolsArr.slice(0, 50) })
            }).catch(err => console.warn('ingest_hist failed (non-blocking):', err));

            // Fetch via proxy to avoid CORS
            // Prioritize top 40 for initial price fetch to surface most-mentioned quickly
            const prioritized = ordered.slice(0, 40);
            const chunkedFetch = async (symbols: string[], chunkSize = 30, retry = 1) => {
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
                        await delay(250);
                        continue;
                      }
                      console.warn(`prices chunk ${idx + 1}/${chunks.length} failed:`, res.status);
                      break;
                    }
                  } catch (e) {
                    if (attempt < retry) {
                      attempt++;
                      await delay(250);
                      continue;
                    }
                    console.warn(`prices chunk ${idx + 1}/${chunks.length} error:`, e);
                    break;
                  }
                }
                // small spacing between chunks
                await delay(100);
              }
              return results;
            };

            const prices = await chunkedFetch(prioritized, 30, 1);
            const priceMap = new Map<string, number>();
            let priceCount = 0;
            prices.forEach(p => {
              if (p.price !== null) {
                priceMap.set(p.symbol, p.price);
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
        }
      }
    } catch (error) {
      console.error('Error fetching stocks:', error);
    } finally {
      setLoading(false);
    }
  };

  // Auto refresh prices every 2 seconds
  useEffect(() => {
    if (stocks.length === 0) return;
    const sorted = [...stocks].sort((a, b) => b.mentionCount - a.mentionCount);
    const symbols = sorted.map(s => s.ticker.toUpperCase());
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
        const priceMap = new Map<string, number>();
        let priceCount = 0;
        aggregate.forEach(p => {
          if (p.price !== null) {
            priceMap.set(p.symbol, p.price);
            priceCount++;
          }
        });
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
        <div className="bg-white shadow-sm rounded-lg mb-6 p-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Stock Ticker Monitor
              </h1>
              <p className="text-gray-600">
                Real-time ticker extraction from Discord messages
              </p>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="/messages"
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <span>💬</span>
                <span>View Messages</span>
              </a>
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                <span className="text-gray-600">
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              {mounted && lastUpdate && (
                <div className="text-gray-500">
                  Last update: {format(lastUpdate, 'HH:mm:ss')}
                </div>
              )}
            </div>
            <Link 
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              View Messages
            </Link>
          </div>
          
          {/* Date Range Selector */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setDateRange('today')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                dateRange === 'today' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setDateRange('week')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                dateRange === 'week' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              This Week
            </button>
            <button
              onClick={() => setDateRange('month')}
              className={`px-4 py-2 rounded-lg transition-colors ${
                dateRange === 'month' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setDateRange('all')}
              className={`px-4 py-2 rounded-lg transition-colors ${
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
                  <div className="text-5xl font-black mb-2 tracking-tight">
                    ${stock.ticker}
                  </div>
                  
                  {/* Mention Count */}
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-3xl font-bold">{stock.mentionCount}</span>
                    <span className="text-sm opacity-90">
                      mention{stock.mentionCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  {/* Live Price */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs opacity-75">Last:</span>
                    <span className="text-lg font-bold">
                      {livePrices.has(stock.ticker) 
                        ? `$${formatPriceTrunc2(livePrices.get(stock.ticker)! as number)}`
                        : '-'
                      }
                    </span>
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
