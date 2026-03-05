import React, { useState, useCallback } from 'react';
import { ArchiveFilters } from '../../../types/archive';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SearchFiltersProps {
    filters: ArchiveFilters;
    onFiltersChange: (filters: ArchiveFilters) => void;
    totalArchives?: number;
    protectedCount?: number;
}

export function SearchFilters({
    filters,
    onFiltersChange,
    totalArchives = 0,
    protectedCount = 0
}: SearchFiltersProps) {
    const [searchTerm, setSearchTerm] = useState(filters.searchQuery || '');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Debounced search
    const debounceTimeout = React.useRef<number>();
    const handleSearchChange = useCallback((value: string) => {
        setSearchTerm(value);

        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }

        debounceTimeout.current = window.setTimeout(() => {
            onFiltersChange({
                ...filters,
                searchQuery: value || undefined
            });
        }, 300);
    }, [filters, onFiltersChange]);

    const handleSortByChange = (sortBy: ArchiveFilters['sortBy']) => {
        onFiltersChange({
            ...filters,
            sortBy
        });
    };

    const handleSortOrderChange = (sortOrder: ArchiveFilters['sortOrder']) => {
        onFiltersChange({
            ...filters,
            sortOrder
        });
    };

    const handleProtectionFilterChange = (protectionStatus: ArchiveFilters['protectionStatus']) => {
        onFiltersChange({
            ...filters,
            protectionStatus
        });
    };

    const handleDateRangeChange = (dateRange: ArchiveFilters['dateRange']) => {
        onFiltersChange({
            ...filters,
            dateRange
        });
    };

    const clearAllFilters = () => {
        setSearchTerm('');
        onFiltersChange({
            sortBy: 'date',
            sortOrder: 'desc'
        });
    };

    const hasActiveFilters = !!(
        filters.searchQuery ||
        filters.protectionStatus !== 'all' ||
        filters.dateRange ||
        filters.sortBy !== 'date' ||
        filters.sortOrder !== 'desc'
    );

    return (
        <div className="search-filters space-y-3">
            {/* Main Search Bar */}
            <div className="flex gap-2">
                <div className="flex-1 relative">
                    <Input
                        type="text"
                        placeholder="Search archives by name, tabs, or reason..."
                        value={searchTerm}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="pr-8"
                    />
                    <i className="fas fa-search absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                </div>

                <Button
                    variant={showAdvancedFilters || hasActiveFilters ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    title="Advanced Filters"
                >
                    <i className="fas fa-sliders-h"></i>
                </Button>

                {hasActiveFilters && (
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={clearAllFilters}
                        title="Clear All Filters"
                    >
                        <i className="fas fa-times-circle"></i>
                    </Button>
                )}
            </div>

            {/* Advanced Filters Panel */}
            {showAdvancedFilters && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4 border border-border">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            Advanced Filters
                        </h4>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            {totalArchives} total archives
                        </span>
                    </div>

                    {/* Sort Options */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Sort By
                            </label>
                            <select
                                value={filters.sortBy}
                                onChange={(e) => handleSortByChange(e.target.value as ArchiveFilters['sortBy'])}
                                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            >
                                <option value="date">Archive Date</option>
                                <option value="name">Name</option>
                                <option value="size">Size</option>
                                <option value="accessCount">Access Count</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Order
                            </label>
                            <select
                                value={filters.sortOrder}
                                onChange={(e) => handleSortOrderChange(e.target.value as ArchiveFilters['sortOrder'])}
                                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            >
                                <option value="desc">Newest First</option>
                                <option value="asc">Oldest First</option>
                            </select>
                        </div>
                    </div>

                    {/* Protection Status Filter */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Protection Status
                        </label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleProtectionFilterChange('all')}
                                className={`px-3 py-1 text-xs rounded transition-colors ${
                                    filters.protectionStatus === 'all' || !filters.protectionStatus
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                                }`}
                            >
                                All ({totalArchives})
                            </button>
                            <button
                                onClick={() => handleProtectionFilterChange('protected')}
                                className={`px-3 py-1 text-xs rounded transition-colors ${
                                    filters.protectionStatus === 'protected'
                                        ? 'bg-yellow-500 text-white'
                                        : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                                }`}
                            >
                                <i className="fas fa-lock mr-1"></i>
                                Protected ({protectedCount})
                            </button>
                            <button
                                onClick={() => handleProtectionFilterChange('unprotected')}
                                className={`px-3 py-1 text-xs rounded transition-colors ${
                                    filters.protectionStatus === 'unprotected'
                                        ? 'bg-green-500 text-white'
                                        : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                                }`}
                            >
                                <i className="fas fa-unlock mr-1"></i>
                                Open ({totalArchives - protectedCount})
                            </button>
                        </div>
                    </div>

                    {/* Date Range Filter */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Archive Date Range
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Input
                                    type="date"
                                    value={filters.dateRange?.start ? new Date(filters.dateRange.start).toISOString().split('T')[0] : ''}
                                    onChange={(e) => {
                                        const startDate = e.target.value ? new Date(e.target.value).getTime() : undefined;
                                        handleDateRangeChange(
                                            startDate
                                                ? { start: startDate, end: filters.dateRange?.end || Date.now() }
                                                : undefined
                                        );
                                    }}
                                    className="text-xs"
                                    placeholder="Start date"
                                />
                            </div>
                            <div>
                                <Input
                                    type="date"
                                    value={filters.dateRange?.end ? new Date(filters.dateRange.end).toISOString().split('T')[0] : ''}
                                    onChange={(e) => {
                                        const endDate = e.target.value ? new Date(e.target.value).getTime() : undefined;
                                        handleDateRangeChange(
                                            endDate
                                                ? { start: filters.dateRange?.start || 0, end: endDate }
                                                : undefined
                                        );
                                    }}
                                    className="text-xs"
                                    placeholder="End date"
                                />
                            </div>
                        </div>

                        {filters.dateRange && (
                            <button
                                onClick={() => handleDateRangeChange(undefined)}
                                className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                Clear date range
                            </button>
                        )}
                    </div>

                    {/* Quick Date Filters */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Quick Filters
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            {[
                                { label: 'Last 7 days', days: 7 },
                                { label: 'Last 30 days', days: 30 },
                                { label: 'Last 90 days', days: 90 },
                                { label: 'This year', days: 365 }
                            ].map(({ label, days }) => (
                                <button
                                    key={label}
                                    onClick={() => {
                                        const endDate = Date.now();
                                        const startDate = endDate - (days * 24 * 60 * 60 * 1000);
                                        handleDateRangeChange({ start: startDate, end: endDate });
                                    }}
                                    className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Active Filters Summary */}
            {hasActiveFilters && (
                <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <span>Active filters:</span>
                    {filters.searchQuery && (
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                            Search: "{filters.searchQuery}"
                        </span>
                    )}
                    {filters.protectionStatus && filters.protectionStatus !== 'all' && (
                        <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded">
                            {filters.protectionStatus === 'protected' ? 'Protected only' : 'Unprotected only'}
                        </span>
                    )}
                    {filters.dateRange && (
                        <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                            Date range set
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}