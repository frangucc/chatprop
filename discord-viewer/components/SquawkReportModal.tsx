'use client';

import { useState, useEffect } from 'react';
import { FaTimes, FaSpinner, FaFileAlt, FaVolumeUp, FaStop, FaArrowLeft } from 'react-icons/fa';

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
        // The API should already return properly parsed data
        let processedData = data;
        
        console.log('[SquawkReportModal] Processed data:', processedData);
        setReportData(processedData);
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
    if (!reportData) {
      console.log('[SquawkReportModal] No reportData in handleTextToSpeech');
      return;
    }
    
    console.log('[SquawkReportModal] handleTextToSpeech starting with reportData:', reportData);

    if (isPlaying && currentAudio) {
      // Stop current playback
      currentAudio.pause();
      setCurrentAudio(null);
      setIsPlaying(false);
      return;
    }

    setAudioLoading(true);
    
    try {
      // Use the audio-optimized text from reportAudio field
      const audioText = reportData.reportAudio || reportData.report;
      console.log('[SquawkReportModal] Using audio text for TTS:', audioText);
      const cleanText = audioText;

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

  // Audio playback functions
  const playAudio = async () => {
    console.log('[SquawkReportModal] playAudio called, reportData:', reportData);
    
    // Check if we have pregenerated audio URL, if so use that instead of TTS
    const preGeneratedAudio = reportData?.reportAudio;
    if (preGeneratedAudio && typeof preGeneratedAudio === 'string' && preGeneratedAudio.startsWith('http')) {
      console.log('[SquawkReportModal] Using pregenerated audio URL:', preGeneratedAudio);
      // Use pregenerated audio file
      try {
        setAudioLoading(true);
        
        // Stop any currently playing audio
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
        }
        
        const audio = new Audio(preGeneratedAudio);
        setCurrentAudio(audio);
        
        audio.onplay = () => {
          setAudioLoading(false);
          setIsPlaying(true);
        };
        
        audio.onended = () => {
          setIsPlaying(false);
          setCurrentAudio(null);
        };
        
        audio.onerror = () => {
          setAudioLoading(false);
          setIsPlaying(false);
          setCurrentAudio(null);
          console.error('Error playing pregenerated audio');
        };
        
        await audio.play();
        return;
      } catch (error) {
        setAudioLoading(false);
        setIsPlaying(false);
        console.error('Error playing pregenerated audio:', error);
        return;
      }
    }

    // If no pregenerated audio, use TTS with audio text version
    console.log('[SquawkReportModal] No pregenerated audio URL, checking for TTS text:', reportData?.reportAudio);
    if (!reportData?.reportAudio) {
      console.log('[SquawkReportModal] No reportAudio found, cannot play audio');
      return;
    }
    
    console.log('[SquawkReportModal] Using TTS with audio text');
    // Use TTS with the audio-optimized text
    await handleTextToSpeech();
  };

  const stopAudio = () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setIsPlaying(false);
      setCurrentAudio(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Desktop Modal */}
      <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4 hidden sm:flex`}>
        <div className={`w-full max-w-4xl max-h-[90vh] rounded-lg shadow-xl ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          {/* Desktop Header */}
          <div className={`flex items-center justify-between p-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-center gap-3">
              <FaFileAlt className={`w-5 h-5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Squawk Report - ${ticker}
              </h2>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <FaTimes className="w-5 h-5" />
            </button>
          </div>

          {/* Desktop Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <FaSpinner className={`w-8 h-8 animate-spin mb-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                <p className={`text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Generating AI squawk report...
                </p>
                <p className={`text-sm mt-2 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Analyzing messages, sentiment, and price movements
                </p>
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">⚠️</div>
                <p className={`text-lg mb-4 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                  Failed to generate report
                </p>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {error}
                </p>
              </div>
            ) : reportData ? (
              <div className="space-y-6">
                {/* Report Content */}
                <div className={`prose max-w-none ${isDarkMode ? 'prose-invert prose-gray' : ''}`} style={isDarkMode ? { color: '#e5e7eb' } : {}}>
                  <div dangerouslySetInnerHTML={{ __html: reportData.reportReadable || reportData.report }} />
                </div>
                
                {/* Audio Controls */}
                {reportData.reportAudio && (
                  <div className={`border-t pt-6 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={isPlaying ? stopAudio : playAudio}
                        disabled={audioLoading}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                          audioLoading
                            ? 'opacity-50 cursor-not-allowed'
                            : isDarkMode
                              ? 'bg-green-600 hover:bg-green-700 text-white'
                              : 'bg-green-600 hover:bg-green-700 text-white'
                        }`}
                      >
                        {audioLoading ? (
                          <FaSpinner className="w-4 h-4 animate-spin" />
                        ) : isPlaying ? (
                          <FaStop className="w-4 h-4" />
                        ) : (
                          <FaVolumeUp className="w-4 h-4" />
                        )}
                        {audioLoading ? 'Loading...' : isPlaying ? 'Stop Audio' : 'Play Audio Report'}
                      </button>
                      <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        Listen to AI-generated audio summary
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <FaFileAlt className={`w-16 h-16 mx-auto mb-4 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                <button
                  onClick={generateReport}
                  className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                    isDarkMode
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  Generate AI Squawk Report
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Full-Screen Modal */}
      <div className={`fixed inset-0 z-[99999] sm:hidden ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
        {/* Mobile Header */}
        <div className={`flex items-center gap-4 p-4 border-b ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
            aria-label="Back to ticker page"
          >
            <FaArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <FaFileAlt className={`w-4 h-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
            <h2 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Squawk Report - ${ticker}
            </h2>
          </div>
          {/* Header Play Button */}
          {reportData?.reportAudio && (
            <button
              onClick={isPlaying ? stopAudio : playAudio}
              disabled={audioLoading}
              className={`p-2 rounded-lg transition-colors ${
                audioLoading
                  ? 'opacity-50 cursor-not-allowed'
                  : isDarkMode
                    ? 'hover:bg-gray-700 text-green-400'
                    : 'hover:bg-gray-100 text-green-600'
              }`}
              aria-label={isPlaying ? 'Stop audio' : 'Play audio report'}
            >
              {audioLoading ? (
                <FaSpinner className="w-4 h-4 animate-spin" />
              ) : isPlaying ? (
                <FaStop className="w-4 h-4" />
              ) : (
                <FaVolumeUp className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        {/* Mobile Content */}
        <div className="flex-1 overflow-y-auto p-4" style={{ height: 'calc(100vh - 80px)' }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FaSpinner className={`w-8 h-8 animate-spin mb-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              <p className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>
                Generating AI squawk report...
              </p>
              <p className={`text-sm mt-2 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                Analyzing messages, sentiment, and price movements
              </p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">⚠️</div>
              <p className={`text-lg mb-4 ${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>
                Failed to generate report
              </p>
              <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                {error}
              </p>
            </div>
          ) : reportData ? (
            <div className="space-y-6">
              {/* Report Content */}
              <div className={`prose max-w-none prose-sm ${isDarkMode ? 'prose-invert prose-gray' : ''}`} style={isDarkMode ? { color: '#e5e7eb' } : {}}>
                <div dangerouslySetInnerHTML={{ __html: reportData.reportReadable || reportData.report }} />
              </div>
              
              {/* Audio Controls */}
              {reportData.reportAudio && (
                <div className={`border-t pt-6 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <button
                      onClick={isPlaying ? stopAudio : playAudio}
                      disabled={audioLoading}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors w-full sm:w-auto justify-center ${
                        audioLoading
                          ? 'opacity-50 cursor-not-allowed'
                          : isDarkMode
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {audioLoading ? (
                        <FaSpinner className="w-4 h-4 animate-spin" />
                      ) : isPlaying ? (
                        <FaStop className="w-4 h-4" />
                      ) : (
                        <FaVolumeUp className="w-4 h-4" />
                      )}
                      {audioLoading ? 'Loading...' : isPlaying ? 'Stop Audio' : 'Play Audio Report'}
                    </button>
                    <p className={`text-sm text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      Listen to AI-generated audio summary
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <FaFileAlt className={`w-16 h-16 mx-auto mb-4 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
              <button
                onClick={generateReport}
                className={`px-6 py-3 rounded-lg font-medium transition-colors w-full sm:w-auto ${
                  isDarkMode
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                Generate AI Squawk Report
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
