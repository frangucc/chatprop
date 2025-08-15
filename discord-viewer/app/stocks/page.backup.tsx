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

  // Helper function to deduplicate stocks by ticker
  const deduplicateStocks = (stocks: Stock[]) => {
    const stockMap = new Map<string, Stock>();
    stocks.forEach(stock => {
      const existing = stockMap.get(stock.ticker);
      if (!existing || stock.mention_count > existing.mention_count) {
        stockMap.set(stock.ticker, stock);
      }
    });
    return Array.from(stockMap.values());
  };

  const fetchStocks = async () => {
    try {
      const tradersParam = selectedTraders.length > 0 
        ? `?traders=${selectedTraders.map(t => t.username).join(',')}` 
        : '';
      const response = await fetch(`/api/stocks-v2${tradersParam}`);
      if (response.ok) {
        const data = await response.json();
        const dedupedData = deduplicateStocks(data);
        setStocks(dedupedData);
      }
    } catch (error) {
      console.error('Error fetching stocks:', error);
    }
  };

  // Rest of the component code...
  // This is the backup of the original page
}
