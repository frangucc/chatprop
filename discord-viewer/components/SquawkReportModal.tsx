'use client';

import { useState, useEffect } from 'react';
import { FaTimes, FaSpinner, FaFileAlt, FaVolumeUp, FaStop } from 'react-icons/fa';

interface SquawkReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  traders?: string[];
  dateRange?: string;
  isDarkMode?: boolean;
}

interface ReportData {
  report: string;
  reportReadable?: string;
  reportAudio?: string;
  metadata: {
    ticker: string;
    messageCount: number;
    dateRange: string;
    filteredTraders?: string[];
    currentPrice?: number;
    priceData?: {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    };
    timeGenerated: string;
  };
}

export default function SquawkReportModal({
  isOpen,
  onClose,
  ticker,
  traders = [],
  dateRange = 'all',
  isDarkMode = false
}: SquawkReportModalProps) {
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);

  // Generate report when modal opens (only once per modal open)
  useEffect(() => {
    if (isOpen && ticker && !reportData && !loading) {
      generateReport();
    } else if (!isOpen) {
      // Reset state when modal closes
      setReportData(null);
      setError(null);
      // Stop any playing audio
      if (currentAudio) {
        currentAudio.pause();
        setCurrentAudio(null);
        setIsPlaying(false);
      }
    }
  }, [isOpen, ticker]);

  // Create a stable key for when filters change to trigger regeneration
  const filtersKey = `${ticker}-${traders.join(',')}-${dateRange}`;
  const [lastFiltersKey, setLastFiltersKey] = useState('');

  // Only regenerate if filters actually changed and modal is open
  useEffect(() => {
    if (isOpen && filtersKey !== lastFiltersKey && lastFiltersKey !== '') {
      setReportData(null);
      setError(null);
      generateReport();
    }
    setLastFiltersKey(filtersKey);
  }, [filtersKey, isOpen]);

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/squawk-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ticker,
          traders: traders.length > 0 ? traders : undefined,
          range: dateRange,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setReportData(data);
      } else {
        setError(data.error || 'Failed to generate squawk report');
      }
    } catch (err) {
      setError('Network error: Failed to generate squawk report');
      console.error('Error generating squawk report:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTextToSpeech = async () => {
    if (!reportData) return;

    if (isPlaying && currentAudio) {
      // Stop current playback
      currentAudio.pause();
      setCurrentAudio(null);
      setIsPlaying(false);
      return;
    }

    setAudioLoading(true);
    
    try {
      // Use the audio-optimized text if available, otherwise clean the readable text
      const audioText = reportData.reportAudio || reportData.report;
      const cleanText = audioText
        .replace(/[•-]/g, '') // Remove bullet points
        .replace(/Key Takeaways:/g, '. Key takeaways.') // Better audio transition
        .replace(/\n\n+/g, '. ') // Replace double newlines with periods
        .replace(/\n/g, ' ') // Replace single newlines with spaces
        .replace(/\s+/g, ' ') // Clean up multiple spaces
        .trim();

      const response = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: cleanText, // Audio-optimized text from AI
          voice_id: 'pNInz6obpgDQGcFmaJgB' // Adam voice - good for financial content
        }),
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        
        audio.onplay = () => setIsPlaying(true);
        audio.onended = () => {
          setIsPlaying(false);
          setCurrentAudio(null);
          URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
          setIsPlaying(false);
          setCurrentAudio(null);
          URL.revokeObjectURL(audioUrl);
          console.error('Audio playback failed');
        };
        
        setCurrentAudio(audio);
        await audio.play();
      } else {
        console.error('TTS request failed:', response.statusText);
      }
    } catch (err) {
      console.error('Error with text-to-speech:', err);
    } finally {
      setAudioLoading(false);
    }
  };

  const formatReport = (report: string) => {
    // Split the report into paragraphs and bullet points
    const parts = report.split('\n\n');
    return parts.map((part, index) => {
      if (part.includes('•') || part.includes('-')) {
        // This looks like a bullet point section
        const lines = part.split('\n').filter(line => line.trim());
        return (
          <div key={index} className="space-y-1">
            {lines.map((line, lineIndex) => (
              <div key={lineIndex} className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {line.trim()}
              </div>
            ))}
          </div>
        );
      } else {
        // Regular paragraph
        return (
          <p key={index} className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {part.trim()}
          </p>
        );
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className={`w-full max-w-4xl max-h-[90vh] rounded-lg shadow-xl ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3">
            <FaFileAlt className={`w-5 h-5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
            <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Squawk Report: ${ticker.toUpperCase()}
            </h2>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              isDarkMode 
                ? 'hover:bg-gray-700 text-gray-400 hover:text-white' 
                : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'
            }`}
          >
            <FaTimes className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FaSpinner className={`w-8 h-8 animate-spin mb-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              <p className={`text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Generating squawk report...
              </p>
              <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Analyzing {ticker.toUpperCase()} trading activity with AI
              </p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="text-red-500 text-6xl mb-4">⚠️</div>
              <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Error Generating Report
              </h3>
              <p className={`text-sm text-center max-w-md ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {error}
              </p>
              <button
                onClick={generateReport}
                className={`mt-4 px-4 py-2 rounded-lg transition-colors ${
                  isDarkMode
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                Try Again
              </button>
            </div>
          ) : reportData ? (
            <div className="space-y-6">
              {/* Metadata */}
              <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      Messages Analyzed:
                    </span>
                    <div className={`font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {reportData.metadata.messageCount}
                    </div>
                  </div>
                  <div>
                    <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      Time Period:
                    </span>
                    <div className={`font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {reportData.metadata.dateRange === 'today' ? 'Today' : 
                       reportData.metadata.dateRange === 'week' ? 'This Week' :
                       reportData.metadata.dateRange === 'month' ? 'This Month' : 'All Time'}
                    </div>
                  </div>
                  {reportData.metadata.currentPrice && (
                    <div>
                      <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        Current Price:
                      </span>
                      <div className={`font-bold ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                        ${reportData.metadata.currentPrice.toFixed(2)}
                      </div>
                    </div>
                  )}
                  {reportData.metadata.priceData && (
                    <div>
                      <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        Daily OHLC:
                      </span>
                      <div className="grid grid-cols-4 gap-2 mt-1">
                        <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          <span className="font-medium">Open:</span> ${reportData.metadata.priceData.open.toFixed(2)}
                        </div>
                        <div className={`text-xs ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                          <span className="font-medium">High:</span> ${reportData.metadata.priceData.high.toFixed(2)}
                        </div>
                        <div className={`text-xs ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                          <span className="font-medium">Low:</span> ${reportData.metadata.priceData.low.toFixed(2)}
                        </div>
                        <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          <span className="font-medium">Close:</span> ${reportData.metadata.priceData.close.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  )}
                  <div>
                    <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      Generated:
                    </span>
                    <div className={`font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {new Date(reportData.metadata.timeGenerated).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                {reportData.metadata.filteredTraders && reportData.metadata.filteredTraders.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-300">
                    <span className={`font-medium text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      Filtered to traders: 
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {reportData.metadata.filteredTraders.map((trader) => (
                        <span 
                          key={trader}
                          className={`px-2 py-1 text-xs rounded ${isDarkMode ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800'}`}
                        >
                          @{trader}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Report Content */}
              <div className="space-y-4">
                <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  AI-Generated Squawk Report
                </h3>
                <div className="space-y-4">
                  {formatReport(reportData.report)}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className={`flex justify-end p-6 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex gap-3">
            {reportData && (
              <>
                <button
                  onClick={handleTextToSpeech}
                  disabled={audioLoading}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    isDarkMode
                      ? 'bg-green-600 hover:bg-green-700 text-white disabled:opacity-50'
                      : 'bg-green-600 hover:bg-green-700 text-white disabled:opacity-50'
                  }`}
                  title={isPlaying ? "Stop audio" : "Read report aloud"}
                >
                  {audioLoading ? (
                    <FaSpinner className="w-4 h-4 animate-spin" />
                  ) : isPlaying ? (
                    <FaStop className="w-4 h-4" />
                  ) : (
                    <FaVolumeUp className="w-4 h-4" />
                  )}
                  {audioLoading ? 'Loading...' : isPlaying ? 'Stop' : 'Listen'}
                </button>
                <button
                  onClick={generateReport}
                  disabled={loading}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-50'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-800 disabled:opacity-50'
                  }`}
                >
                  Regenerate Report
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-lg transition-colors ${
                isDarkMode
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}