import React, { useState, useEffect } from 'react';
import { AuroraBackground } from '@/components/ui/aurora-background';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { Storage } from '@/utils/storage';
import type { Settings, TabGroup } from '@/types/models';
import { getDefaultSettings } from '@/utils/sorting';
import Logo from '@/components/Logo';

interface SearchResult {
    type: 'group' | 'tab';
    id: string;
    title: string;
    subtitle?: string;
    url?: string;
    groupId?: string;
}

const NewTab = () => {
    const [time, setTime] = useState(new Date());
    const [searchQuery, setSearchQuery] = useState('');
    const [isEnabled, setIsEnabled] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [showResults, setShowResults] = useState(false);

    useEffect(() => {
        // Check if custom new tab is enabled and get theme
        const checkSettings = async () => {
            const storedSettings = await Storage.get<Settings>('settings');
            const settings = { ...getDefaultSettings(), ...storedSettings };

            if (!settings.customNewTabEnabled) {
                // Redirect to blank page when disabled
                window.location.replace('about:blank');
                return;
            }

            // Set theme
            const theme = settings.theme || 'system';
            if (theme === 'dark') {
                document.documentElement.classList.add('dark');
            } else if (theme === 'light') {
                document.documentElement.classList.remove('dark');
            } else {
                // System theme
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (prefersDark) {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            }

            setIsEnabled(true);
            setIsLoading(false);
        };

        checkSettings();
    }, []);

    useEffect(() => {
        if (!isEnabled) return;

        const timer = setInterval(() => {
            setTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, [isEnabled]);

    useEffect(() => {
        const searchInStorage = async () => {
            if (!searchQuery.trim()) {
                setSearchResults([]);
                setShowResults(false);
                return;
            }

            const groups = await Storage.get<TabGroup[]>('groups') || [];
            const results: SearchResult[] = [];
            const query = searchQuery.toLowerCase();

            // Search groups
            groups.forEach(group => {
                if (group.name.toLowerCase().includes(query)) {
                    results.push({
                        type: 'group',
                        id: group.id,
                        title: group.name,
                        subtitle: `${group.tabs.length} tabs`
                    });
                }

                // Search tabs within groups
                group.tabs.forEach(tab => {
                    if (tab.title.toLowerCase().includes(query) || tab.url.toLowerCase().includes(query)) {
                        results.push({
                            type: 'tab',
                            id: tab.id,
                            title: tab.title,
                            subtitle: group.name,
                            url: tab.url,
                            groupId: group.id
                        });
                    }
                });
            });

            setSearchResults(results.slice(0, 8)); // Limit to 8 results
            setShowResults(results.length > 0);
        };

        const debounce = setTimeout(searchInStorage, 200);
        return () => clearTimeout(debounce);
    }, [searchQuery]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            // Use browser's default search engine
            chrome.search.query({
                text: searchQuery,
                disposition: 'CURRENT_TAB'
            });
        }
    };

    const handleResultClick = async (result: SearchResult) => {
        if (result.type === 'group') {
            // Open BlueTab manager (it will show the groups)
            chrome.runtime.openOptionsPage();
        } else if (result.type === 'tab' && result.url) {
            // Open the specific tab
            window.location.href = result.url;
        }
        setShowResults(false);
        setSearchQuery('');
    };

    if (isLoading || !isEnabled) {
        return null;
    }

    return (
        <AuroraBackground>
            <motion.div
                initial={{ opacity: 0.0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{
                    delay: 0.3,
                    duration: 0.8,
                    ease: "easeInOut",
                }}
                className="relative flex flex-col gap-8 items-center justify-center px-4 w-full max-w-4xl h-screen"
            >
                <div className="flex-1 flex flex-col gap-8 items-center justify-center w-full">
                    <div className="text-7xl md:text-9xl font-bold text-slate-900 dark:text-white tracking-tighter">
                        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>

                    <div className="text-xl md:text-2xl text-slate-600 dark:text-slate-300 font-light">
                        {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                    </div>

                    <div className="w-full max-w-2xl mt-8 relative">
                        <form onSubmit={handleSearch} className="relative group">
                            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none z-10">
                                <Search className="h-5 w-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                            </div>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => searchResults.length > 0 && setShowResults(true)}
                                onBlur={() => setTimeout(() => setShowResults(false), 200)}
                                placeholder="Search groups, tabs, or the web..."
                                className="w-full py-4 pl-12 pr-4 text-lg bg-white/50 dark:bg-black/20 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all hover:shadow-md text-slate-900 dark:text-white placeholder:text-slate-400"
                                autoFocus
                            />
                        </form>

                        {/* Search Results Dropdown */}
                        {showResults && searchResults.length > 0 && (
                            <div className="absolute top-full mt-2 w-full bg-white/90 dark:bg-gray-800/90 backdrop-blur-lg border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden z-50">
                                <div className="max-h-96 overflow-y-auto">
                                    {searchResults.map((result, index) => (
                                        <button
                                            key={`${result.type}-${result.id}-${index}`}
                                            onClick={() => handleResultClick(result)}
                                            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left border-b border-slate-100 dark:border-slate-700 last:border-b-0"
                                        >
                                            <div className={`px-2 py-1 rounded text-xs font-medium ${result.type === 'group'
                                                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                                                : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                                }`}>
                                                {result.type === 'group' ? 'Group' : 'Tab'}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-slate-900 dark:text-white truncate">
                                                    {result.title}
                                                </div>
                                                {result.subtitle && (
                                                    <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
                                                        {result.subtitle}
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Logo at bottom */}
                <div className="pb-8">
                    <Logo size="popup" />
                </div>
            </motion.div>
        </AuroraBackground>
    );
};

export default NewTab;
