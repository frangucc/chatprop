'use client';

import { useState, useEffect } from 'react';

interface Trader {
  username: string;
  nickname: string | null;
  avatar_url?: string | null;
  avatar?: string | null;
  stock_count?: number;
  stocksMentioned?: number;
  last_activity?: string;
  lastActivity?: string;
}

interface TraderFilterProps {
  selectedTraders: Trader[];
  onTradersChange: (traders: Trader[]) => void;
  placeholder?: string;
  className?: string;
  isDarkMode?: boolean;
}

export default function TraderFilter({ 
  selectedTraders, 
  onTradersChange, 
  placeholder = "@username - Filter by trader...",
  className = "",
  isDarkMode = false
}: TraderFilterProps) {
  const [traderSearch, setTraderSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Trader[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  // Search for traders
  const searchTraders = async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    try {
      console.log('[TraderFilter] Searching for:', query);
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        const users = data.users || data; // Handle both response formats
        console.log('[TraderFilter] Found users:', users.length, users);
        setSearchResults(users);
        setShowDropdown(true);
      } else {
        console.error('[TraderFilter] Search failed:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('[TraderFilter] Error searching traders:', error);
    }
  };

  // Add trader to filter
  const addTrader = (trader: Trader) => {
    if (!selectedTraders.find(t => t.username === trader.username)) {
      const newTraders = [...selectedTraders, trader];
      onTradersChange(newTraders);
      setTraderSearch('');
      setSearchResults([]);
      setShowDropdown(false);
    }
  };

  // Remove trader from filter
  const removeTrader = (username: string) => {
    const newTraders = selectedTraders.filter(t => t.username !== username);
    onTradersChange(newTraders);
  };

  // Handle trader search input
  const handleTraderSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTraderSearch(value);
    searchTraders(value);
  };

  // Handle Enter key in trader search
  const handleTraderSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchResults.length > 0) {
      e.preventDefault();
      addTrader(searchResults[0]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setTraderSearch('');
    } else if (e.key === 'ArrowDown' && searchResults.length > 0) {
      e.preventDefault();
      // Focus could be improved here, but for now just ensure dropdown is visible
      setShowDropdown(true);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.trader-filter-container')) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`trader-filter-container space-y-3 ${className}`}>
      {/* Search Input */}
      <div className="relative" style={{ zIndex: 10 }}>
        <div className="relative">
          <input
            type="text"
            placeholder={placeholder}
            value={traderSearch}
            onChange={handleTraderSearchChange}
            onKeyDown={handleTraderSearchKeyDown}
            onFocus={() => traderSearch.length >= 2 && setShowDropdown(true)}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${isDarkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900'}`}
          />
          {traderSearch.length >= 2 && searchResults.length === 0 && showDropdown && (
            <div className={`absolute w-full mt-1 p-3 border rounded-lg shadow-lg ${isDarkMode ? 'bg-gray-800 border-gray-600 text-gray-400' : 'bg-white border-gray-200 text-gray-500'}`}
                 style={{ zIndex: 10, top: '100%' }}>
              <div className="text-sm">No traders found matching "{traderSearch}"</div>
            </div>
          )}
        </div>
        
        {/* Search Dropdown */}
        {(() => {
          console.log('[TraderFilter] Dropdown state - showDropdown:', showDropdown, 'searchResults:', searchResults.length);
          return null;
        })()}
        {showDropdown && searchResults.length > 0 && (
          <div 
            className={`absolute w-full mt-1 border-2 rounded-lg shadow-2xl max-h-60 overflow-y-auto ${isDarkMode ? 'bg-gray-800 border-blue-500' : 'bg-white border-blue-400'}`} 
            style={{
              position: 'absolute',
              zIndex: 10,
              top: '100%',
              left: 0,
              right: 0
            }}
          >
            {searchResults.map((user) => (
              <div
                key={user.username}
                onClick={() => addTrader(user)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b last:border-b-0 ${isDarkMode ? 'hover:bg-gray-700 border-gray-600' : 'hover:bg-gray-50 border-gray-100'}`}
              >
                <img
                  src={user.avatar_url || user.avatar || '/api/placeholder/32/32'}
                  alt={user.username}
                  className="w-8 h-8 rounded-full"
                />
                <div className="flex-1">
                  <div className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {user.nickname || user.username}
                  </div>
                  {user.nickname && (
                    <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>@{user.username}</div>
                  )}
                </div>
                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {user.stock_count || user.stocksMentioned} stocks
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Traders Tags */}
      {selectedTraders.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {selectedTraders.map((trader) => (
            <div
              key={trader.username}
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${isDarkMode ? 'bg-green-900/30 text-green-300 border border-green-700' : 'bg-green-100 text-green-800'}`}
            >
              <img
                src={trader.avatar_url || trader.avatar || '/api/placeholder/20/20'}
                alt={trader.username}
                className="w-5 h-5 rounded-full"
              />
              <span className="font-medium">
                {trader.nickname || trader.username}
              </span>
              <button
                onClick={() => removeTrader(trader.username)}
                className={`ml-1 ${isDarkMode ? 'text-green-400 hover:text-green-200' : 'text-green-600 hover:text-green-800'}`}
                title="Remove trader filter"
              >
                ×
              </button>
            </div>
          ))}
          <div className={`inline-flex items-center px-2 py-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            Filtering by {selectedTraders.length} trader{selectedTraders.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
