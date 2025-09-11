'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { FaMoon, FaSun, FaArrowLeft, FaFileAlt } from 'react-icons/fa';
import { format } from 'date-fns';
import TraderFilter from '../../../components/TraderFilter';
import SquawkReportModal from '../../../components/SquawkReportModal';

interface Message {
  id: string;
  content: string;
  timestamp: string;
  timestamp_edited: string | null;
  author_name: string;
  author_nickname: string | null;
  author_avatar_url: string;
  attachments: any[];
  embeds: any[];
  reactions: any[];
}

interface Trader {
  username: string;
  nickname: string | null;
  avatar: string | null;
}

interface LivePrice {
  symbol: string;
  price: number;
  ts: number | null;
}

export default function TickerChatsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const ticker = params.ticker as string; // ticker comes clean without $
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [isIgnored, setIsIgnored] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [contextNote, setContextNote] = useState('');
  const [selectedTraders, setSelectedTraders] = useState<Trader[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [priceChangePercent, setPriceChangePercent] = useState<number | null>(null);
  const [firstMentionPrice, setFirstMentionPrice] = useState<string | null>(null);
  const [firstMentionAuthor, setFirstMentionAuthor] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true); // Default to dark mode
  const [mounted, setMounted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messagePrices, setMessagePrices] = useState<{[key: string]: any}>({});
  const [dateRange, setDateRange] = useState('all');
  const [urlInitialized, setUrlInitialized] = useState(false);
  const [livePrices, setLivePrices] = useState<Map<string, { price: number; ts: number | null }>>(new Map());
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [showSquawkModal, setShowSquawkModal] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [pageSize] = useState(100);
  const [hasMore, setHasMore] = useState(true);
  const router = useRouter();

  // Price formatter: truncate to 2 decimals (no rounding)
  const formatPriceTrunc2 = (p: number) => {
    const truncated = Math.floor(p * 100) / 100;
    return truncated.toFixed(2);
  };

  // Tick every second to update 'seconds ago' counters
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live price for the current ticker
  const fetchLivePrice = async () => {
    try {
      const response = await fetch(`/api/live/prices?symbols=${ticker.toUpperCase()}`);
      if (response.ok) {
        const data: LivePrice[] = await response.json();
        const priceData = data.find(p => p.symbol.toUpperCase() === ticker.toUpperCase());
        if (priceData) {
          setLivePrices(prev => {
            const newMap = new Map(prev);
            newMap.set(ticker.toUpperCase(), {
              price: priceData.price,
              ts: priceData.ts
            });
            return newMap;
          });
        }
      }
    } catch (error) {
      console.error('Error fetching live price:', error);
    }
  };

  useEffect(() => {
    setMounted(true);
    const urlParams = new URLSearchParams(window.location.search);
    const tradersParam = urlParams.get('traders');
    const darkParam = urlParams.get('dark');
    
    if (tradersParam) {
      const traderUsernames = tradersParam.split(',');
      // Convert usernames to trader objects (simplified)
      const traders = traderUsernames.map(username => ({
        username: username.trim(),
        nickname: null,
        avatar: null
      }));
      setSelectedTraders(traders);
    }
    
    if (darkParam === 'true') {
      setIsDarkMode(true);
    }
    
    const rangeParam = urlParams.get('range');
    if (rangeParam) {
      setDateRange(rangeParam);
    }
  }, []);

  useEffect(() => {
    // Initialize traders from URL parameters
    const initializeFromUrl = async () => {
      const tradersParam = searchParams.get('traders');
      if (tradersParam) {
        const traderUsernames = tradersParam.split(',').filter(Boolean);
        if (traderUsernames.length > 0) {
          try {
            // Fetch trader details for each username
            const traderPromises = traderUsernames.map(async (username) => {
              const response = await fetch(`/api/users/search?q=${encodeURIComponent(username)}`);
              if (response.ok) {
                const users = await response.json();
                const trader = users.find((u: any) => u.username === username);
                return trader || { username, nickname: username, avatar: null };
              }
              return { username, nickname: username, avatar: null };
            });
            
            const tradersFromUrl = await Promise.all(traderPromises);
            setSelectedTraders(tradersFromUrl);
          } catch (error) {
            console.error('Error fetching trader details:', error);
            // Fallback to basic trader objects
            const tradersFromUrl = traderUsernames.map(username => ({ 
              username, 
              nickname: username, 
              avatar: null 
            }));
            setSelectedTraders(tradersFromUrl);
          }
        }
      }
      
      // Mark URL initialization as complete
      setUrlInitialized(true);
    };
    
    initializeFromUrl();
  }, [ticker, searchParams]);

  // Refetch messages when traders or date range change, but only after URL is initialized
  useEffect(() => {
    if (urlInitialized) {
      fetchTickerMessages();
    }
  }, [selectedTraders, dateRange, urlInitialized]);

  // Fetch live price when component mounts and ticker changes
  useEffect(() => {
    if (ticker) {
      fetchLivePrice();
      // Set up interval to refresh live price every 30 seconds
      const interval = setInterval(fetchLivePrice, 30000);
      return () => clearInterval(interval);
    }
  }, [ticker]);

  // Fetch historical prices for individual messages
  useEffect(() => {
    if (messages.length > 0) {
      // Clear existing prices when messages change
      setMessagePrices({});
      
      // Fetch prices for all messages using Databento API
      messages.forEach(async (message) => {
        try {
          const isoTimestamp = new Date(message.timestamp).toISOString();
          const response = await fetch(`/api/databento?symbol=${ticker}&timestamp=${isoTimestamp}`);
          const data = await response.json();
          
          if (response.ok && data.price && data.price > 0) {
            setMessagePrices(prev => ({
              ...prev,
              [message.id]: {
                ...data,
                formattedPrice: `$${data.price.toFixed(2)}`
              }
            }));
          }
        } catch (error) {
          console.error(`Error fetching price for message ${message.id}:`, error);
        }
      });
    }
  }, [messages, ticker]);

  const fetchTickerMessages = async (isLoadMore = false) => {
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setCurrentOffset(0); // Reset pagination for new queries
      setHasMore(true); // Reset hasMore flag
    }
    
    try {
      const tradersParam = selectedTraders.length > 0 
        ? `&traders=${selectedTraders.map(t => t.username).join(',')}` 
        : '';
      const rangeParam = dateRange !== 'all' ? `&range=${dateRange}` : '';
      const paginationParams = `&limit=${pageSize}&offset=${isLoadMore ? currentOffset : 0}`;
      
      // Use the new messages API that works with the clean database
      const response = await fetch(`/api/messages-v2?ticker=${ticker}${tradersParam}${rangeParam}${paginationParams}`);
      const data = await response.json();
      
      if (response.ok) {
        if (isLoadMore) {
          // Append new messages to existing ones
          setMessages(prevMessages => [...prevMessages, ...data.messages]);
          const newOffset = currentOffset + data.messages.length;
          setCurrentOffset(newOffset);
          // Check if we've loaded all messages
          setHasMore(data.messages.length === pageSize && newOffset < data.total);
        } else {
          // Replace messages for fresh queries
          setMessages(data.messages);
          setCurrentOffset(data.messages.length);
          setHasMore(data.messages.length === pageSize && data.messages.length < data.total);
        }
        
        setTotal(data.total);
        // Set first mention price and author from API response (only for fresh queries)
        if (!isLoadMore) {
          setFirstMentionPrice(data.firstMentionPrice);
          setFirstMentionAuthor(data.firstMentionAuthor);
        }
      }
    } catch (error) {
      console.error('Error fetching ticker messages:', error);
    } finally {
      if (isLoadMore) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  };

  // Load more messages function
  const loadMoreMessages = async () => {
    if (!hasMore || loadingMore) return;
    await fetchTickerMessages(true);
  };

  // Update URL with current state
  const updateUrl = (traders: Trader[], dark?: boolean) => {
    const url = new URL(window.location.href);
    
    if (traders.length > 0) {
      url.searchParams.set('traders', traders.map(t => t.username).join(','));
    } else {
      url.searchParams.delete('traders');
    }
    
    const darkMode = dark !== undefined ? dark : isDarkMode;
    if (darkMode) {
      url.searchParams.set('dark', 'true');
    } else {
      url.searchParams.delete('dark');
    }
    
    window.history.pushState({}, '', url.toString());
  };
  
  // Handle trader filter changes
  const handleTradersChange = (traders: Trader[]) => {
    setSelectedTraders(traders);
    updateUrl(traders, isDarkMode);
  };

  const handleDateRangeChange = (range: string) => {
    setDateRange(range);
    
    // Update URL with new date range
    const params = new URLSearchParams(window.location.search);
    if (range !== 'all') {
      params.set('range', range);
    } else {
      params.delete('range');
    }
    if (selectedTraders.length > 0) {
      params.set('traders', selectedTraders.map(t => t.username).join(','));
    }
    if (isDarkMode) {
      params.set('dark', 'true');
    }
    const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.pushState({}, '', newUrl);
    
    // Refetch messages with new date range
    fetchTickerMessages();
  };

  // Handle dark mode toggle
  const toggleDarkMode = (dark: boolean) => {
    setIsDarkMode(dark);
    updateUrl(selectedTraders, dark);
  };


  // Highlight the ticker in message content
  const highlightTicker = (content: string) => {
    const regex = new RegExp(`\\b(${ticker})\\b`, 'gi');
    const parts = content.split(regex);
    
    return parts.map((part, index) => {
      if (part.toUpperCase() === ticker.toUpperCase()) {
        return (
          <span key={index} className="bg-yellow-200 font-bold px-1 rounded">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className={`min-h-screen py-8 ${isDarkMode ? 'bg-[#181717]' : 'bg-gray-50'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className={`shadow-sm rounded-lg mb-6 p-4 sm:p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Left side - Back button and ticker */}
            <div className="flex items-center gap-3 sm:gap-4">
              <button
                onClick={() => {
                  // Navigate directly to /stocks with preserved filters
                  const params = new URLSearchParams();
                  if (selectedTraders.length > 0) {
                    params.set('traders', selectedTraders.map(t => t.username).join(','));
                  }
                  if (dateRange !== 'all') {
                    params.set('range', dateRange);
                  }
                  if (isDarkMode) {
                    params.set('dark', 'true');
                  }
                  const stocksUrl = params.toString() ? `/stocks?${params.toString()}` : '/stocks';
                  router.push(stocksUrl);
                }}
                className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                aria-label="Back to stocks"
              >
                <FaArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <div>
                <h1 className={`text-2xl sm:text-4xl font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>${ticker}</h1>
              </div>
            </div>
            
            {/* Right side - Price Display and Actions */}
            <div className="flex flex-col sm:flex-row items-start sm:items-start gap-3 sm:gap-6">
              {/* Last Price Display */}
              <div className="text-left sm:text-right">
                <p className={`text-xs sm:text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Last price</p>
                <div className="flex items-center gap-2">
                  <div className={`text-xl sm:text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {livePrices.has(ticker.toUpperCase()) 
                      ? `$${formatPriceTrunc2(livePrices.get(ticker.toUpperCase())!.price)}`
                      : '-'}
                  </div>
                  {livePrices.has(ticker.toUpperCase()) && (
                    <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {(() => {
                        const entry = livePrices.get(ticker.toUpperCase())!;
                        if (!entry.ts) return '';
                        const secs = Math.max(0, Math.floor((Date.now() - entry.ts / 1_000_000) / 1000));
                        return `${secs}s ago`;
                      })()} 
                    </div>
                  )}
                  {/* Squawk Report Button (moved here, smaller) */}
                  <button
                    onClick={() => setShowSquawkModal(true)}
                    className={`ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                      isDarkMode
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                    title="Generate AI-powered squawk report"
                  >
                    <FaFileAlt className="w-3 h-3" />
                    <span className="hidden sm:inline">Squawk</span>
                  </button>
                </div>
              </div>
              
              {/* First Mention Price Display */}
              {firstMentionPrice && (
                <div className="text-left sm:text-right">
                  <p className={`text-xs sm:text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>First mention price</p>
                  <div className="flex items-center gap-2 sm:gap-4">
                    <div className={`text-xl sm:text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {firstMentionPrice}
                    </div>
                    {firstMentionAuthor && (
                      <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        by @{firstMentionAuthor}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Date Range and Trader Filter */}
        <div className={`shadow-sm rounded-lg mb-6 p-4 sm:p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          {/* Date Range Buttons */}
          <div className="mb-4 sm:mb-6">
            <div className="grid grid-cols-4 gap-1 sm:gap-2">
              {['today', 'week', 'month', 'all'].map((range) => (
                <button
                  key={range}
                  onClick={() => handleDateRangeChange(range)}
                  className={`px-2 py-2 sm:px-4 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    dateRange === range
                      ? isDarkMode
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-600 text-white'
                      : isDarkMode
                        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {range === 'today' ? 'Today' : range === 'week' ? 'Week' : range === 'month' ? 'Month' : 'All'}
                </button>
              ))}
            </div>
          </div>
          
          <div className={showSquawkModal ? 'hidden' : ''}>
            <TraderFilter
              selectedTraders={selectedTraders}
              onTradersChange={handleTradersChange}
              placeholder={`Filter messages by trader for ${ticker}...`}
              isDarkMode={isDarkMode}
            />
          </div>
        </div>


        {/* Messages Section Header */}
        <div className="mb-4">
          <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            All messages mentioning ${ticker}
          </h2>
        </div>

        {/* Messages */}
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className={`animate-spin rounded-full h-12 w-12 border-b-2 ${isDarkMode ? 'border-white' : 'border-gray-900'}`}></div>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">💬</div>
              <p className={`text-lg ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                No messages found for ${ticker}
                {selectedTraders.length > 0 && ` from selected traders`}
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={message.author_avatar_url || '/api/placeholder/40/40'}
                      alt={message.author_name}
                      className="w-10 h-10 rounded-full"
                    />
                    <div>
                      <div className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {message.author_nickname || message.author_name}
                      </div>
                      <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        @{message.author_name} • {format(new Date(message.timestamp), 'MMM d, yyyy h:mm a')}
                      </div>
                    </div>
                  </div>
                  {messagePrices[message.id] && (
                    <div className={`text-sm font-medium ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                      {messagePrices[message.id].formattedPrice}
                    </div>
                  )}
                  {/* Debug: Show if we have any prices at all */}
                  {Object.keys(messagePrices).length === 0 && messages.length > 0 && (
                    <div className="text-xs text-red-500">
                      No prices loaded ({Object.keys(messagePrices).length}/{messages.length})
                    </div>
                  )}
                </div>
                <div className={`whitespace-pre-wrap leading-relaxed ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {message.content}
                </div>
              </div>
            ))
          )}
        </div>
        
        {/* Load More Button */}
        {!loading && messages.length > 0 && hasMore && (
          <div className="text-center mt-8">
            <button
              onClick={loadMoreMessages}
              disabled={loadingMore || !hasMore}
              className={`px-6 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                isDarkMode 
                  ? 'bg-blue-600 text-white hover:bg-blue-700' 
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {loadingMore ? 'Loading...' : 'Load More Messages'}
            </button>
          </div>
        )}

        {/* Squawk Report Modal */}
        <SquawkReportModal
          isOpen={showSquawkModal}
          onClose={() => setShowSquawkModal(false)}
          ticker={ticker}
          traders={selectedTraders.map(t => t.username)}
          dateRange={dateRange}
          isDarkMode={isDarkMode}
        />
      </div>
    </div>
  );
}
