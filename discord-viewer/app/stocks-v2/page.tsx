'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';

interface Stock {
  ticker: string;
  exchange: string;
  mentionCount: number;
  uniqueAuthors: number;
  avgConfidence: number;
  firstMention: string;
  lastMention: string;
  sampleMentions?: string[];
  mentionedByTrader: boolean;
  momentum: string;
}

export default function StocksPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('today');
  const [trader, setTrader] = useState('');
  const [search, setSearch] = useState('');
  const [minConfidence, setMinConfidence] = useState(0.7);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    fetchStocks();
    const interval = setInterval(fetchStocks, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [dateRange, trader, search, minConfidence]);

  const fetchStocks = async () => {
    try {
      const params = new URLSearchParams({
        dateRange,
        minConfidence: minConfidence.toString()
      });
      
      if (trader) params.append('trader', trader);
      if (search) params.append('search', search);
      
      const response = await fetch(`/api/stocks-v3?${params}`);
      const data = await response.json();
      
      setStocks(data.stocks || []);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching stocks:', error);
    } finally {
      setLoading(false);
    }
  };

  const dateRangeOptions = [
    { value: 'today', label: 'Today', icon: '📅' },
    { value: 'week', label: 'This Week', icon: '📊' },
    { value: 'month', label: 'This Month', icon: '📈' },
    { value: 'all', label: 'All Time', icon: '♾️' }
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
            📈 ChatProp Ticker Tracker
          </h1>
          <p className="text-gray-400">
            Real-time Discord ticker extraction with smart filtering
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Last updated: {formatDistanceToNow(lastUpdate, { addSuffix: true })}
          </p>
        </div>

        {/* Filters */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Date Range Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Date Range
              </label>
              <div className="flex gap-2">
                {dateRangeOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setDateRange(option.value)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      dateRange === option.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    title={option.label}
                  >
                    <span className="mr-1">{option.icon}</span>
                    <span className="hidden sm:inline">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Search Ticker
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value.toUpperCase())}
                placeholder="e.g., TSLA"
                className="w-full px-3 py-2 bg-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Trader Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Specific Trader
              </label>
              <input
                type="text"
                value={trader}
                onChange={(e) => setTrader(e.target.value)}
                placeholder="Username"
                className="w-full px-3 py-2 bg-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Confidence Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Min Confidence: {(minConfidence * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                value={minConfidence}
                onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-400">{stocks.length}</div>
            <div className="text-sm text-gray-400">Active Tickers</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-400">
              {stocks.reduce((sum, s) => sum + s.mentionCount, 0)}
            </div>
            <div className="text-sm text-gray-400">Total Mentions</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-400">
              {stocks.filter(s => s.mentionedByTrader).length}
            </div>
            <div className="text-sm text-gray-400">By Known Traders</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-orange-400">
              {stocks.filter(s => s.momentum.includes('Hot')).length}
            </div>
            <div className="text-sm text-gray-400">Hot Tickers 🔥</div>
          </div>
        </div>

        {/* Ticker Table */}
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        ) : stocks.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400">No tickers found for the selected criteria</p>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Ticker
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Momentum
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Mentions
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Authors
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Confidence
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Last Seen
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Sample
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {stocks.map((stock, index) => (
                  <tr
                    key={stock.ticker}
                    className="hover:bg-gray-700 transition-colors"
                  >
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-lg font-bold text-white">
                            ${stock.ticker}
                          </div>
                          <div className="text-xs text-gray-400">
                            {stock.exchange}
                          </div>
                        </div>
                        {stock.mentionedByTrader && (
                          <span className="ml-2 text-xs bg-green-600 text-white px-2 py-1 rounded">
                            Trader
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className="text-sm">{stock.momentum}</span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="text-lg font-semibold text-blue-400">
                        {stock.mentionCount}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="text-sm text-gray-300">
                        {stock.uniqueAuthors}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex items-center justify-center">
                        <div
                          className={`text-sm font-medium px-2 py-1 rounded ${
                            stock.avgConfidence >= 0.9
                              ? 'bg-green-900 text-green-300'
                              : stock.avgConfidence >= 0.8
                              ? 'bg-yellow-900 text-yellow-300'
                              : 'bg-gray-700 text-gray-300'
                          }`}
                        >
                          {(stock.avgConfidence * 100).toFixed(0)}%
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-400">
                      {stock.lastMention && 
                        formatDistanceToNow(new Date(stock.lastMention), { addSuffix: true })
                      }
                    </td>
                    <td className="px-4 py-4">
                      {stock.sampleMentions && stock.sampleMentions[0] && (
                        <div className="text-xs text-gray-400 max-w-xs truncate" title={stock.sampleMentions[0]}>
                          "{stock.sampleMentions[0]}"
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            💡 Tip: {dateRange === 'today' ? 
              'Showing tickers mentioned today. Switch to "Week" view for trending tickers.' :
              dateRange === 'week' ?
              'Great for spotting weekly trends. Use "Today" for fresh picks.' :
              'Long-term view active. Use "Today" for immediate opportunities.'
            }
          </p>
        </div>
      </div>
    </div>
  );
}
