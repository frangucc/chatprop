'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TraderFilter from '@/components/TraderFilter';

interface Stock {
  ticker: string;
  exchange: string;
  mention_count: number;
  detection_confidence: number;
  ai_confidence?: number;
  first_mention_timestamp: string;
  first_mention_author: string;
  is_genuine_stock: boolean;
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

  const fetchStocks = async () => {
    try {
      const tradersParam = selectedTraders.length > 0 
        ? `?traders=${selectedTraders.map(t => t.username).join(',')}` 
        : '';
      const response = await fetch(`/api/stocks${tradersParam}`);
      if (response.ok) {
        const data = await response.json();
        setStocks(data);
      }
    } catch (error) {
      console.error('Error fetching stocks:', error);
    }
  };

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
    setLoading(false);

    // Initialize from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
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
        
        if (message.type === 'initial_tickers' || message.type === 'ticker_update') {
          if (message.type === 'initial_tickers') {
            setStocks(message.data || []);
          } else {
            // Update specific ticker
            setStocks(prevStocks => {
              const existingIndex = prevStocks.findIndex(s => s.ticker === message.data.ticker);
              if (existingIndex >= 0) {
                const updated = [...prevStocks];
                updated[existingIndex] = message.data;
                return updated;
              } else {
                return [...prevStocks, message.data];
              }
            });
          }
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

  // Refetch stocks when traders change
  useEffect(() => {
    if (mounted && urlInitialized) {
      fetchStocks();
    }
  }, [selectedTraders, mounted, urlInitialized]);

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
    return '📈';
  };



  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-400';
    if (confidence >= 0.8) return 'text-yellow-400';
    return 'text-red-400';
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
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
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
              
              {/* Batch Processing Button */}
              <button
                onClick={startBatchProcess}
                disabled={batchProcessing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {batchProcessing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    🔄 Process Today's Messages
                  </>
                )}
              </button>
            </div>
            <Link 
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              View Messages
            </Link>
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
              <p className="text-sm text-orange-600 font-medium">Hot Tickers (10+)</p>
              <p className="text-2xl font-bold text-orange-900">
                {stocks.filter(s => s.mention_count >= 10).length}
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
                <div className={`${getCardColor(stock.mention_count)} p-6 text-white`}>
                  {/* Heat Indicator */}
                  <div className="absolute top-2 right-2 text-2xl">
                    {getHeatLevel(stock.mention_count)}
                  </div>
                  
                  {/* Ticker Symbol */}
                  <div className="text-5xl font-black mb-2 tracking-tight">
                    ${stock.ticker}
                  </div>
                  
                  {/* Mention Count */}
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-3xl font-bold">{stock.mention_count}</span>
                    <span className="text-sm opacity-90">
                      mention{stock.mention_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  {/* Confidence Score */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs opacity-75">Confidence:</span>
                    <span className={`text-sm font-bold ${getConfidenceColor(stock.detection_confidence)}`}>
                      {(stock.detection_confidence * 100).toFixed(0)}%
                    </span>
                    {stock.ai_confidence && (
                      <span className="text-xs opacity-75">
                        (AI: {(stock.ai_confidence * 100).toFixed(0)}%)
                      </span>
                    )}
                  </div>
                  
                  {/* First Mention Info */}
                  <div className="border-t border-white/20 pt-3 space-y-2">
                    <div className="text-xs opacity-75">First mention</div>
                    <div className="text-sm font-medium">
                      {format(new Date(stock.first_mention_timestamp), 'HH:mm:ss')}
                    </div>
                    <div className="text-xs opacity-90">
                      by {stock.first_mention_author}
                    </div>
                  </div>
                </div>
                
                {/* Exchange Info */}
                <div className="bg-white/10 p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white/90 text-sm">
                      <span className="font-semibold">Exchange:</span> {stock.exchange}
                    </span>
                    {stock.is_genuine_stock ? (
                      <span className="text-green-400 text-xs">✓ Verified</span>
                    ) : (
                      <span className="text-yellow-400 text-xs">⚠ Pending</span>
                    )}
                  </div>
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
