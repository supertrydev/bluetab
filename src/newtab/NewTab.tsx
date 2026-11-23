import { matchesSearch, normalizeForSearch } from '@/utils/search-text';
import React, { useState, useEffect } from 'react';
import { AuroraBackground } from '@/components/ui/aurora-background';
import { Search } from 'lucide-react';
import {
    applyNewTabDocumentMetadata,
    formatNewTabDate,
    formatNewTabTime,
    type NewTabTimeFormat,
    getNewTabStrings,
    resolveNewTabLanguage,
    type NewTabLanguage,
} from './localization';
import { PomodoroStatusDeferred } from './PomodoroStatusDeferred';
import { applyNewTabTheme, loadNewTabGroups, loadNewTabSettings } from './runtime';
import { useNewTabSimplifyMode } from './useNewTabSimplifyMode';

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
    const [language, setLanguage] = useState<NewTabLanguage>('en');
    const [timeFormat, setTimeFormat] = useState<NewTabTimeFormat>('system');

    // Phase 9 Plan 09-04 — wire Simplify Mode attributes on <html> so
    // simplify.css rules cascade across the newtab surface.
    useNewTabSimplifyMode();

    useEffect(() => {
        // Check if custom new tab is enabled and get theme
        const checkSettings = async () => {
            const settings = await loadNewTabSettings();

            if (!settings.customNewTabEnabled) {
                // Redirect to blank page when disabled
                window.location.replace('about:blank');
                return;
            }

            applyNewTabTheme(settings.theme);
            const resolvedLanguage = resolveNewTabLanguage(settings.language);
            applyNewTabDocumentMetadata(resolvedLanguage);
            setLanguage(resolvedLanguage);
            setTimeFormat(settings.timeFormat === '12h' || settings.timeFormat === '24h' ? settings.timeFormat : 'system');
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

            const groups = await loadNewTabGroups();
            const results: SearchResult[] = [];
            const query = normalizeForSearch(searchQuery);
            const strings = getNewTabStrings(language);

            // Search groups
            groups.forEach(group => {
                if (matchesSearch(group.name, query)) {
                    results.push({
                        type: 'group',
                        id: group.id,
                        title: group.name,
                        subtitle: strings.tabsCount(group.tabs.length),
                    });
                }

                // Search tabs within groups
                group.tabs.forEach(tab => {
                    if (matchesSearch(tab.title, query) || matchesSearch(tab.url, query)) {
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
    }, [searchQuery, language]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            window.location.href = `https://www.google.com/search?q=${encodeURIComponent(searchQuery.trim())}`;
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

    const strings = getNewTabStrings(language);

    return (
        <AuroraBackground>
            <div className="fixed inset-x-0 top-0 z-50">
                <PomodoroStatusDeferred />
            </div>
            <div className="relative flex flex-col gap-8 items-center justify-center px-4 w-full max-w-4xl h-screen">
                <div className="flex-1 flex flex-col gap-8 items-center justify-center w-full">
                    <div dir="ltr" className="text-7xl md:text-9xl font-bold text-slate-900 dark:text-white tracking-tighter">
                        {formatNewTabTime(time, language, { hour: '2-digit', minute: '2-digit' }, timeFormat)}
                    </div>

                    <div dir="ltr" className="text-xl md:text-2xl text-slate-600 dark:text-slate-300 font-light">
                        {formatNewTabDate(time, language, { weekday: 'long', month: 'long', day: 'numeric' })}
                    </div>

                    <div className="w-full max-w-2xl mt-8 relative">
                        <form onSubmit={handleSearch} className="relative group">
                            <div className="absolute inset-y-0 start-4 flex items-center pointer-events-none z-10">
                                <Search className="h-5 w-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                            </div>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => searchResults.length > 0 && setShowResults(true)}
                                onBlur={() => setTimeout(() => setShowResults(false), 200)}
                                placeholder={strings.searchPlaceholder}
                                dir="auto"
                                className="w-full py-4 ps-12 pe-4 text-lg bg-white/50 dark:bg-black/20 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all hover:shadow-md text-slate-900 dark:text-white placeholder:text-slate-400"
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
                                                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-start border-b border-slate-100 dark:border-slate-700 last:border-b-0"
                                        >
                                            <div className={`px-2 py-1 rounded text-xs font-medium ${result.type === 'group'
                                                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                                                : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                                }`}>
                                                {result.type === 'group'
                                                    ? strings.groupLabel
                                                    : strings.tabLabel}
                                            </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-slate-900 dark:text-white truncate">
                                                        <bdi dir="auto">{result.title}</bdi>
                                                    </div>
                                                    {result.subtitle && (
                                                        <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
                                                            <bdi dir="auto">{result.subtitle}</bdi>
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
            </div>
        </AuroraBackground>
    );
};

export default NewTab;
