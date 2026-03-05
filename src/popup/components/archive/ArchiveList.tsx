import React, { useState, useEffect, useCallback } from 'react';
import { ArchivedGroup, ArchiveFilters } from '../../../types/archive';
import { ArchiveItem } from './ArchiveItem';
import { ArchiveService } from '../../../services/archive-service';

interface ArchiveListProps {
    onArchiveSelect?: (archive: ArchivedGroup) => void;
    onArchiveRestore?: (archive: ArchivedGroup) => void;
    onArchiveView?: (archive: ArchivedGroup) => void;
    onArchiveDelete?: (archive: ArchivedGroup) => void;
    filters?: ArchiveFilters;
    onFiltersChange?: (filters: ArchiveFilters) => void;
    refreshKey?: number;
}

export function ArchiveList({
    onArchiveSelect,
    onArchiveRestore,
    onArchiveView,
    onArchiveDelete,
    filters,
    onFiltersChange,
    refreshKey
}: ArchiveListProps) {
    const [archives, setArchives] = useState<ArchivedGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);

    const loadArchives = useCallback(async () => {
        setLoading(true);
        try {
            const result = await ArchiveService.getArchiveList(filters);
            setArchives(result);
        } catch (error) {
            console.error('Failed to load archives:', error);
            setArchives([]);
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        setCurrentPage(1);
        loadArchives();
    }, [filters, refreshKey, loadArchives]);


    // Pagination
    const totalPages = Math.ceil(archives.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentArchives = archives.slice(startIndex, endIndex);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading archives...</span>
                </div>
            </div>
        );
    }

    if (archives.length === 0) {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center -mt-12">
                {/* Icon Circle */}
                <div className="w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-700/30 flex items-center justify-center mb-6">
                    <i className="fas fa-archive text-3xl text-gray-500 dark:text-gray-500"></i>
                </div>

                {/* Title */}
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    No Archives Found
                </h3>

                {/* Description */}
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md leading-relaxed">
                    {filters?.searchQuery ? (
                        <>No archives match your search criteria. Try different keywords or clear the search.</>
                    ) : (
                        <>Archive your tab groups to access them later. It's a great way to save sessions for later!</>
                    )}
                </p>

                {/* Clear Search Button */}
                {filters?.searchQuery && (
                    <button
                        onClick={() => onFiltersChange?.({
                            ...filters,
                            searchQuery: undefined
                        })}
                        className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                    >
                        Clear Search
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="archive-list">
            {/* Archive Items */}
            <div className="space-y-2 mb-4 mt-2">
                {currentArchives.map(archive => (
                    <ArchiveItem
                        key={archive.id}
                        archive={archive}
                        onSelect={onArchiveSelect}
                        onRestore={onArchiveRestore}
                        onView={onArchiveView}
                        onDelete={onArchiveDelete}
                        showActions={true}
                    />
                ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        Showing {startIndex + 1}-{Math.min(endIndex, archives.length)} of {archives.length} archives
                    </div>

                    <div className="flex gap-1">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <i className="fas fa-chevron-left"></i>
                        </button>

                        <span className="px-2 py-1 text-xs text-gray-700 dark:text-gray-300">
                            {currentPage} / {totalPages}
                        </span>

                        <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <i className="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
