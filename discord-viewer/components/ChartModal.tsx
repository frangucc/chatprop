'use client';

import React, { useEffect, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
// import { LineData } from 'lightweight-charts';
import SimpleChart from './SimpleChart';

interface ChartModalProps {
  symbol: string;
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
}

interface HistoricalDataPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export default function ChartModal({ symbol, isOpen, onClose, isDarkMode = false }: ChartModalProps) {
  const [chartData, setChartData] = useState<HistoricalDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChartData = async () => {
    if (!symbol) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Get today's date in YYYY-MM-DD format
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      
      // Fetch 1-minute bar data for today from our API
      const response = await fetch(`/api/chart/${symbol}?date=${dateStr}&interval=1m`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch chart data: ${response.statusText}`);
      }
      
      const data: HistoricalDataPoint[] = await response.json();
      
      // Just pass the raw data for now
      setChartData(data);
    } catch (err) {
      console.error('Error fetching chart data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch chart data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && symbol) {
      fetchChartData();
    }
  }, [isOpen, symbol]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div 
        className={`w-full max-w-4xl max-h-[90vh] rounded-lg shadow-xl overflow-hidden ${
          isDarkMode ? 'bg-gray-800' : 'bg-white'
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b ${
          isDarkMode ? 'border-gray-700' : 'border-gray-200'
        }`}>
          <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            ${symbol} Chart
          </h2>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              isDarkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
            }`}
            aria-label="Close chart"
          >
            <FaTimes className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className={`animate-spin rounded-full h-12 w-12 border-b-2 ${
                isDarkMode ? 'border-white' : 'border-gray-900'
              }`}></div>
            </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center h-64">
              <div className={`text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <div className="text-4xl mb-4">📊</div>
                <p className="text-lg mb-2">Chart data unavailable</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}
          
          {!loading && !error && chartData.length > 0 && (
            <SimpleChart 
              symbol={symbol} 
              data={chartData} 
              isDarkMode={isDarkMode}
            />
          )}
          
          {!loading && !error && chartData.length === 0 && (
            <div className="flex items-center justify-center h-64">
              <div className={`text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <div className="text-4xl mb-4">📈</div>
                <p className="text-lg mb-2">No chart data available</p>
                <p className="text-sm">No trading data found for ${symbol} today</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}