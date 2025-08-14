'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import TraderFilter from '@/components/TraderFilter';

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
  const [selectedExamples, setSelectedExamples] = useState<Set<string>>(new Set());
  const [selectedTraders, setSelectedTraders] = useState<any[]>([]);

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
      
      checkIfIgnored();
    };
    
    initializeFromUrl();
  }, [ticker, searchParams]);

  // Refetch messages when traders change
  useEffect(() => {
    fetchTickerMessages();
  }, [selectedTraders]);

  const fetchTickerMessages = async () => {
    setLoading(true);
    try {
      const tradersParam = selectedTraders.length > 0 
        ? `&traders=${selectedTraders.map(t => t.username).join(',')}` 
        : '';
      const response = await fetch(`/api/messages?ticker=${ticker}${tradersParam}`);
      const data = await response.json();
      
      if (response.ok) {
        setMessages(data.messages);
        setTotal(data.total);
      }
    } catch (error) {
      console.error('Error fetching ticker messages:', error);
    } finally {
      setLoading(false);
    }
  };

  // Update URL parameters when traders change
  const updateUrl = (traders: any[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (traders.length > 0) {
      params.set('traders', traders.map(t => t.username).join(','));
    } else {
      params.delete('traders');
    }
    
    const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  };

  // Handle trader filter changes
  const handleTradersChange = (traders: any[]) => {
    setSelectedTraders(traders);
    updateUrl(traders);
  };

  // Refetch messages when traders change
  useEffect(() => {
    if (selectedTraders.length >= 0) { // Always refetch, even when empty
      fetchTickerMessages();
    }
  }, [selectedTraders]);

  const checkIfIgnored = async () => {
    try {
      const response = await fetch('/api/blacklist');
      if (response.ok) {
        const blacklist = await response.json();
        const isTickerIgnored = blacklist.some((item: any) => item.ticker === ticker.toUpperCase());
        setIsIgnored(isTickerIgnored);
      }
    } catch (error) {
      console.error('Error checking blacklist:', error);
    }
  };

  const handleIgnoreToggle = async () => {
    if (ignoring) return;
    
    if (!isIgnored) {
      // Show note input when marking as false positive
      setShowNoteInput(true);
      return;
    }
    
    // Remove from blacklist
    setIgnoring(true);
    try {
      const response = await fetch(`/api/blacklist?ticker=${ticker}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setIsIgnored(false);
        setShowNoteInput(false);
        setContextNote('');
      }
    } catch (error) {
      console.error('Error removing from blacklist:', error);
    } finally {
      setIgnoring(false);
    }
  };

  const handleAddToBlacklist = async () => {
    setIgnoring(true);
    try {
      // Get selected example messages
      const exampleMessages = Array.from(selectedExamples).map(id => {
        const message = messages.find(m => m.id === id);
        return message ? message.content : null;
      }).filter(Boolean);

      const response = await fetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticker: ticker.toUpperCase(), 
          reason: 'User marked as false positive from ticker page',
          contextNote: contextNote.trim() || undefined,
          exampleMessages: exampleMessages.length > 0 ? exampleMessages : undefined
        })
      });
      if (response.ok) {
        setIsIgnored(true);
        setShowNoteInput(false);
        setContextNote('');
        setSelectedExamples(new Set());
      }
    } catch (error) {
      console.error('Error adding to blacklist:', error);
    } finally {
      setIgnoring(false);
    }
  };

  const handleCancelNote = () => {
    setShowNoteInput(false);
    setContextNote('');
    setSelectedExamples(new Set());
  };

  const toggleExampleMessage = (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    setSelectedExamples(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
        // Remove message content from textarea (only remove first occurrence)
        setContextNote(prevNote => {
          const lines = prevNote.split('\n');
          const targetContent = message.content.trim();
          const indexToRemove = lines.findIndex(line => line.trim() === targetContent);
          if (indexToRemove !== -1) {
            lines.splice(indexToRemove, 1);
          }
          return lines.join('\n');
        });
      } else {
        newSet.add(messageId);
        // Add message content to textarea only if it's not already there
        setContextNote(prevNote => {
          const lines = prevNote.split('\n').map(line => line.trim());
          const targetContent = message.content.trim();
          if (!lines.includes(targetContent)) {
            const newContent = prevNote.trim() ? `${prevNote}\n${message.content}` : message.content;
            return newContent;
          }
          return prevNote;
        });
      }
      return newSet;
    });
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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="bg-white shadow-sm rounded-lg mb-6 p-6">
          {/* Top Row: Title and Actions */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-4xl font-black text-gray-900">
                  ${ticker}
                </h1>
                <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded-full">
                  {total} mentions
                </span>
              </div>
              <p className="text-gray-600">All messages mentioning this ticker</p>
            </div>
            
            <div className="flex gap-2">
              <Link
                href="/stocks"
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                ← Back to Stocks
              </Link>
              <Link
                href="/"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                All Messages
              </Link>
            </div>
          </div>

          {/* Blacklist Controls */}
          <div className="border-t pt-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isIgnored}
                  onChange={handleIgnoreToggle}
                  disabled={ignoring}
                  className="w-5 h-5 text-red-600 bg-gray-100 border-gray-300 rounded focus:ring-red-500 focus:ring-2"
                />
                <span className="text-lg font-medium text-gray-700">
                  {isIgnored ? '✓ Ignored (False Positive)' : 'Mark as False Positive'}
                </span>
                {ignoring && (
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                )}
              </label>
            </div>

            {/* Context Note Input */}
            {showNoteInput && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h4 className="font-semibold text-gray-900 mb-2">Add Context Note</h4>
                <p className="text-sm text-gray-600 mb-3">
                  Help the AI understand when this is a false positive vs. a real stock mention.
                </p>
                <textarea
                  value={contextNote}
                  onChange={(e) => setContextNote(e.target.value)}
                  placeholder={`Example for ALL: "ALL is being used as the normal word, not a ticker here. There is a ticker in the NYSE called $ALL however, but none of these contexts are using the word as a ticker."`}
                  className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  rows={3}
                />
                
                {selectedExamples.size > 0 && (
                  <p className="text-sm text-red-600 mt-3">
                    {selectedExamples.size} example message(s) selected - they will be appended to your note
                  </p>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleAddToBlacklist}
                    disabled={ignoring}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                  >
                    {ignoring ? 'Adding...' : 'Add to Blacklist'}
                  </button>
                  <button
                    onClick={handleCancelNote}
                    className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Trader Filter */}
        <div className="bg-white shadow-sm rounded-lg mb-6 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Filter Messages by Trader</h3>
          <TraderFilter
            selectedTraders={selectedTraders}
            onTradersChange={handleTradersChange}
            placeholder="@username - Filter messages by specific traders..."
          />
          {selectedTraders.length > 0 && (
            <p className="text-sm text-gray-600 mt-2">
              Showing messages from {selectedTraders.length} selected trader{selectedTraders.length !== 1 ? 's' : ''} only
            </p>
          )}
        </div>

        {/* Messages */}
        <div className="space-y-4">
          {loading ? (
            <div className="bg-white rounded-lg p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              <p className="mt-2 text-gray-600">Loading messages...</p>
            </div>
          ) : messages.length > 0 ? (
            messages.map((message) => (
              <div
                key={message.id}
                className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-6"
              >
                <div className="flex gap-4">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    <img
                      className="h-12 w-12 rounded-full"
                      src={message.author_avatar_url || '/api/placeholder/48/48'}
                      alt={message.author_name}
                    />
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-gray-900">
                        {message.author_nickname || message.author_name}
                      </span>
                      {message.author_nickname && (
                        <span className="text-xs text-gray-500">
                          @{message.author_name}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">•</span>
                      <span className="text-xs text-gray-500">
                        {format(new Date(message.timestamp), 'HH:mm:ss')}
                      </span>
                      {message.timestamp_edited && (
                        <span className="text-xs text-gray-400 italic">(edited)</span>
                      )}
                    </div>
                    
                    <div className="text-gray-800 break-words">
                      {message.content ? (
                        <p>{highlightTicker(message.content)}</p>
                      ) : (
                        <p className="text-gray-400 italic">No content</p>
                      )}
                    </div>
                    
                    {/* Attachments & Embeds */}
                    <div className="mt-2 flex gap-2">
                      {message.attachments && message.attachments.length > 0 && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          📎 {message.attachments.length} file(s)
                        </span>
                      )}
                      {message.embeds && message.embeds.length > 0 && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          🔗 {message.embeds.length} embed(s)
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Right side: Timestamp and Example Checkbox */}
                  <div className="flex-shrink-0 text-right flex flex-col items-end gap-2">
                    <div className="text-sm text-gray-500">
                      {format(new Date(message.timestamp), 'MMM dd, yyyy')}
                    </div>
                    
                    {/* Example Message Checkbox - only show when in blacklist mode */}
                    {showNoteInput && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-600">Example</label>
                        <input
                          type="checkbox"
                          checked={selectedExamples.has(message.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleExampleMessage(message.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 text-red-600 bg-gray-100 border-gray-300 rounded focus:ring-red-500 focus:ring-2"
                          title="Include this message as an example of false positive usage"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-lg p-8 text-center">
              <p className="text-gray-500">No messages found for ${ticker}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
