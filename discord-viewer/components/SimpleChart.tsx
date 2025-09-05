'use client';

import React, { useEffect, useRef } from 'react';

interface SimpleChartProps {
  symbol: string;
  data: any[];
  isDarkMode?: boolean;
}

export default function SimpleChart({ symbol, data, isDarkMode = false }: SimpleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    let chartInstance: any = null;

    const initChart = async () => {
      try {
        // Clean up any existing chart first
        if (chartInstance) {
          chartInstance.remove();
          chartInstance = null;
        }

        // Dynamic import
        const { createChart } = await import('lightweight-charts');

        // Create chart with dark theme styling
        const chart = createChart(chartContainerRef.current!, {
          width: chartContainerRef.current!.clientWidth,
          height: 400,
          layout: {
            background: { color: isDarkMode ? '#1f2937' : '#ffffff' },
            textColor: isDarkMode ? '#e5e7eb' : '#374151',
          },
          grid: {
            vertLines: { color: isDarkMode ? '#374151' : '#e5e7eb' },
            horzLines: { color: isDarkMode ? '#374151' : '#e5e7eb' },
          },
          crosshair: {
            mode: 1,
          },
          localization: {
            timeFormatter: (time: any) => {
              const date = new Date(time * 1000);
              return date.toLocaleString('en-US', {
                timeZone: 'America/Chicago', // Force CST timezone for tooltips
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              });
            },
          },
          rightPriceScale: {
            borderColor: isDarkMode ? '#6b7280' : '#d1d5db',
            textColor: isDarkMode ? '#e5e7eb' : '#374151',
          },
          timeScale: {
            borderColor: isDarkMode ? '#6b7280' : '#d1d5db',
            textColor: isDarkMode ? '#e5e7eb' : '#374151',
            timeVisible: true,
            secondsVisible: false,
            tickMarkFormatter: (time: any) => {
              const date = new Date(time * 1000);
              return date.toLocaleTimeString('en-US', {
                timeZone: 'America/Chicago', // Force CST timezone
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              });
            },
          },
        });

        chartInstance = chart;

        // Add line series with cyan color
        const lineSeries = chart.addLineSeries({
          color: '#06b6d4', // Tailwind cyan-500
          lineWidth: 2,
          priceFormat: {
            type: 'price',
            precision: 2,
            minMove: 0.01,
          },
        });

        // Debug: Log the raw data
        console.log('Chart received data points:', data.length);
        if (data.length > 0) {
          console.log('First data point:', data[0]);
          console.log('Last data point:', data[data.length - 1]);
        }

        // Convert data format - only include data points that have actual trades
        const chartData = data
          .filter(point => point.close > 0) // Only include points with actual price data
          .map(point => {
            // Create date and convert to Unix timestamp for lightweight-charts
            const date = new Date(point.time);
            return {
              time: Math.floor(date.getTime() / 1000),
              value: point.close
            };
          });

        console.log('Chart data after processing:', chartData.length, 'points');
        if (chartData.length > 0) {
          console.log('First chart point time:', new Date(chartData[0].time * 1000).toISOString());
          console.log('Last chart point time:', new Date(chartData[chartData.length - 1].time * 1000).toISOString());
        }

        if (chartData.length > 0) {
          lineSeries.setData(chartData);
          chart.timeScale().fitContent();
        }

        // Handle resize
        const handleResize = () => {
          if (chartInstance && chartContainerRef.current) {
            chartInstance.applyOptions({
              width: chartContainerRef.current.clientWidth,
            });
          }
        };

        window.addEventListener('resize', handleResize);

        // Store cleanup function
        return () => {
          window.removeEventListener('resize', handleResize);
          if (chartInstance) {
            chartInstance.remove();
            chartInstance = null;
          }
        };

      } catch (error) {
        console.error('Error in chart creation:', error);
      }
    };

    const cleanup = initChart();

    return () => {
      if (cleanup instanceof Promise) {
        cleanup.then(cleanupFn => cleanupFn && cleanupFn());
      }
      if (chartInstance) {
        chartInstance.remove();
        chartInstance = null;
      }
    };
  }, [data, isDarkMode]);

  // Calculate time range for display
  const getTimeRangeDisplay = () => {
    if (!data || data.length === 0) return '';
    
    const validData = data.filter(point => point.close > 0);
    if (validData.length === 0) return '';
    
    const firstTime = new Date(validData[0].time);
    const lastTime = new Date(validData[validData.length - 1].time);
    
    // Format in local timezone (which should be CST for your system)
    const formatTime = (date: Date) => {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      });
    };
    
    return `${formatTime(firstTime).replace(' CST', '')} - ${formatTime(lastTime).replace(' CST', '')} CST`;
  };

  return (
    <div className="w-full">
      <div className="mb-4">
        <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          ${symbol} - Today's 1-Minute Chart
        </h3>
        {data && data.length > 0 && (
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {getTimeRangeDisplay()}
          </p>
        )}
      </div>
      <div 
        ref={chartContainerRef} 
        className="w-full h-[400px] rounded-lg border-0"
      />
    </div>
  );
}