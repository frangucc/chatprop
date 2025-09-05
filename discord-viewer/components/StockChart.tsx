'use client';

import React, { useEffect, useRef, useState } from 'react';
import { LineData } from 'lightweight-charts';

interface StockChartProps {
  symbol: string;
  data: LineData[];
  isDarkMode?: boolean;
}

export default function StockChart({ symbol, data, isDarkMode = false }: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    let cleanup: (() => void) | null = null;

    // Dynamically import lightweight-charts for client-side rendering
    const initChart = async () => {
      try {
        const { createChart } = await import('lightweight-charts');
        console.log('Creating chart with createChart function:', typeof createChart);
        
        // Try minimal chart creation first
        const chart = createChart(chartContainerRef.current!, {
          width: chartContainerRef.current!.clientWidth || 600,
          height: 400,
        });

        console.log('Chart created:', chart);
        console.log('Chart type:', typeof chart);
        console.log('Chart keys:', Object.keys(chart || {}));
        console.log('Has addLineSeries:', typeof chart?.addLineSeries);
        console.log('Chart prototype:', Object.getPrototypeOf(chart));
        console.log('Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(chart || {})));

        // Create line series
        const lineSeries = chart.addLineSeries({
          color: '#08c0b1',
          lineWidth: 2,
          priceFormat: {
            type: 'price',
            precision: 2,
            minMove: 0.01,
          },
        });

        // Set data
        lineSeries.setData(data);

        // Fit content
        chart.timeScale().fitContent();

        chartRef.current = chart;
        seriesRef.current = lineSeries;

        // Handle resize
        const handleResize = () => {
          if (chartContainerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: chartContainerRef.current.clientWidth,
            });
          }
        };

        window.addEventListener('resize', handleResize);

        // Set cleanup function
        cleanup = () => {
          window.removeEventListener('resize', handleResize);
          if (chartRef.current) {
            chartRef.current.remove();
            chartRef.current = null;
            seriesRef.current = null;
          }
        };
      } catch (error) {
        console.error('Error creating chart:', error);
      }
    };

    initChart();

    return () => {
      if (cleanup) cleanup();
    };
  }, [data, isDarkMode]);

  return (
    <div className="w-full">
      <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        ${symbol} - Today's 1-Minute Chart
      </h3>
      <div 
        ref={chartContainerRef} 
        className="w-full h-[400px] border rounded-lg"
        style={{ borderColor: isDarkMode ? '#4b5563' : '#d1d5db' }}
      />
    </div>
  );
}