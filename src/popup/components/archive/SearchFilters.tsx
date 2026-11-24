import React, { useState, useCallback } from 'react';
import { addLocalDays, parseLocalDateKey, toLocalDateInputValue } from '@/utils/local-date';
import { Search, SlidersHorizontal, XCircle, Lock, Unlock } from 'lucide-react';
import { ArchiveFilters } from '../../../types/archive';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
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
                        placeholder={t('archive.search.placeholder')}
                        value={searchTerm}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="pe-8"
                    />
                    <Search className="w-4 h-4 absolute end-3 top-1/2 transform -translate-y-1/2 text-text-muted" />
                </div>

                <Button
                    variant={showAdvancedFilters || hasActiveFilters ? "primary" : "outline"}
                    size="sm"
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    title={t('archive.search.advancedFilters')}
                >
                    <SlidersHorizontal className="w-4 h-4" />
                </Button>

                {hasActiveFilters && (
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={clearAllFilters}
                        title={t('archive.search.clearAllFilters')}
                    >
                        <XCircle className="w-4 h-4" />
                    </Button>
                )}
            </div>

            {/* Advanced Filters Panel */}
            {showAdvancedFilters && (
                <div className="bg-muted rounded-lg p-4 space-y-4 border border-border">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-text-strong">
                            {t('archive.search.advancedFilters')}
                        </h4>
                        <span className="text-xs text-text-muted">
                            {t('archive.search.totalArchives', { count: totalArchives })}
                        </span>
                    </div>

                    {/* Sort Options */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-text-strong mb-1">
                                {t('archive.search.sortBy')}
                            </label>
                            <select
                                value={filters.sortBy}
                                onChange={(e) => handleSortByChange(e.target.value as ArchiveFilters['sortBy'])}
                                className="w-full px-3 py-1 text-xs border border-field rounded-input bg-bg-1 text-foreground"
                            >
                                <option value="date">{t('archive.search.archiveDate')}</option>
                                <option value="name">{t('archive.search.name')}</option>
                                <option value="size">{t('archive.search.size')}</option>
                                <option value="accessCount">{t('archive.search.accessCount')}</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-text-strong mb-1">
                                {t('archive.search.order')}
                            </label>
                            <select
                                value={filters.sortOrder}
                                onChange={(e) => handleSortOrderChange(e.target.value as ArchiveFilters['sortOrder'])}
                                className="w-full px-3 py-1 text-xs border border-field rounded-input bg-bg-1 text-foreground"
                            >
                                <option value="desc">{t('archive.search.newestFirst')}</option>
                                <option value="asc">{t('archive.search.oldestFirst')}</option>
                            </select>
                        </div>
                    </div>

                    {/* Protection Status Filter */}
                    <div>
                        <label className="block text-xs font-medium text-text-strong mb-2">
                            {t('archive.search.protectionStatus')}
                        </label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleProtectionFilterChange('all')}
                                className={`px-3 py-1 text-xs rounded transition-colors ${
                                    filters.protectionStatus === 'all' || !filters.protectionStatus
                                        ? 'bg-primary text-white'
                                        : 'bg-accent text-text-strong'
                                }`}
                            >
                                {t('archive.search.all', { count: totalArchives })}
                            </button>
                            <button
                                onClick={() => handleProtectionFilterChange('protected')}
                                className={`px-3 py-1 text-xs rounded transition-colors ${
                                    filters.protectionStatus === 'protected'
                                        ? 'bg-warning text-white'
                                        : 'bg-accent text-text-strong'
                                }`}
                            >
                                <Lock className="w-3 h-3 me-1 inline" />
                                {t('archive.search.protected', { count: protectedCount })}
                            </button>
                            <button
                                onClick={() => handleProtectionFilterChange('unprotected')}
                                className={`px-3 py-1 text-xs rounded transition-colors ${
                                    filters.protectionStatus === 'unprotected'
                                        ? 'bg-success text-white'
                                        : 'bg-accent text-text-strong'
                                }`}
                            >
                                <Unlock className="w-3 h-3 me-1 inline" />
                                {t('archive.search.open', { count: totalArchives - protectedCount })}
                            </button>
                        </div>
                    </div>

                    {/* Date Range Filter */}
                    <div>
                        <label className="block text-xs font-medium text-text-strong mb-2">
                            {t('archive.search.archiveDateRange')}
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Input
                                    type="date"
                                    value={filters.dateRange?.start ? toLocalDateInputValue(filters.dateRange.start) : ''}
                                    onChange={(e) => {
                                        // Local midnight of the picked day (new Date('YYYY-MM-DD') is UTC).
                                        const startDate = e.target.value ? parseLocalDateKey(e.target.value).getTime() : undefined;
                                        handleDateRangeChange(
                                            startDate
                                                ? { start: startDate, end: filters.dateRange?.end || Date.now() }
                                                : undefined
                                        );
                                    }}
                                    className="text-xs"
                                    dir="ltr"
                                    placeholder={t('archive.search.startDate')}
                                />
                            </div>
                            <div>
                                <Input
                                    type="date"
                                    value={filters.dateRange?.end ? toLocalDateInputValue(filters.dateRange.end) : ''}
                                    onChange={(e) => {
                                        // End of the picked local day, so the whole day is included.
                                        const endDate = e.target.value
                                            ? addLocalDays(parseLocalDateKey(e.target.value), 1).getTime() - 1
                                            : undefined;
                                        handleDateRangeChange(
                                            endDate
                                                ? { start: filters.dateRange?.start || 0, end: endDate }
                                                : undefined
                                        );
                                    }}
                                    className="text-xs"
                                    dir="ltr"
                                    placeholder={t('archive.search.endDate')}
                                />
                            </div>
                        </div>

                        {filters.dateRange && (
                            <button
                                onClick={() => handleDateRangeChange(undefined)}
                                className="mt-1 text-xs text-primary hover:underline"
                            >
                                {t('archive.search.clearDateRange')}
                            </button>
                        )}
                    </div>

                    {/* Quick Date Filters */}
                    <div>
                        <label className="block text-xs font-medium text-text-strong mb-2">
                            {t('archive.search.quickFilters')}
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            {[
                                { label: t('archive.search.last7Days'), days: 7 },
                                { label: t('archive.search.last30Days'), days: 30 },
                                { label: t('archive.search.last90Days'), days: 90 },
                                { label: t('archive.search.thisYear'), days: 365 }
                            ].map(({ label, days }) => (
                                <button
                                    key={label}
                                    onClick={() => {
                                        const endDate = Date.now();
                                        const startDate = endDate - (days * 24 * 60 * 60 * 1000);
                                        handleDateRangeChange({ start: startDate, end: endDate });
                                    }}
                                    className="px-2 py-1 text-xs bg-accent text-text-strong rounded-full hover:bg-accent transition-colors"
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
                <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>{t('archive.search.activeFilters')}</span>
                    {filters.searchQuery && (
                        <span className="px-2 py-1 bg-primary-muted text-primary rounded">
                            {t('archive.search.activeSearch', { query: filters.searchQuery })}
                        </span>
                    )}
                    {filters.protectionStatus && filters.protectionStatus !== 'all' && (
                        <span className="px-2 py-1 bg-warning-muted text-warning rounded">
                            {filters.protectionStatus === 'protected'
                                ? t('archive.search.protectedOnly')
                                : t('archive.search.unprotectedOnly')}
                        </span>
                    )}
                    {filters.dateRange && (
                        <span className="px-2 py-1 bg-success-muted text-success rounded">
                            {t('archive.search.dateRangeSet')}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
