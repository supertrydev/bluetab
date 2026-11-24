import { useState, useEffect, useCallback } from 'react';
import { Loader2, Archive, ChevronLeft, ChevronRight } from 'lucide-react';
import { ArchivedGroup, ArchiveFilters } from '../../../types/archive';
import { ArchiveItem } from './ArchiveItem';
import { ArchiveService } from '../../../services/archive-service';
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
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
                <div className="flex items-center gap-2 text-text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('archive.list.loading')}</span>
                </div>
            </div>
        );
    }

    if (archives.length === 0) {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center -mt-12">
                {/* Icon Circle */}
                <div className="w-24 h-24 rounded-full bg-accent flex items-center justify-center mb-6">
                    <Archive className="w-8 h-8 text-text-muted" />
                </div>

                {/* Title */}
                <h3 className="text-xl font-semibold text-text-strong mb-3">
                    {t('archive.list.emptyTitle')}
                </h3>

                {/* Description */}
                <p className="text-sm text-text-muted max-w-md leading-relaxed">
                    {filters?.searchQuery ? (
                        <>{t('archive.list.emptySearch')}</>
                    ) : (
                        <>{t('archive.list.emptyDefault')}</>
                    )}
                </p>

                {/* Clear Search Button */}
                {filters?.searchQuery && (
                    <button
                        onClick={() => onFiltersChange?.({
                            ...filters,
                            searchQuery: undefined
                        })}
                        className="mt-6 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-full transition-colors"
                    >
                        {t('archive.list.clearSearch')}
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
                    <div className="text-xs text-text-muted">
                        {t('archive.list.showing', {
                            start: startIndex + 1,
                            end: Math.min(endIndex, archives.length),
                            total: archives.length,
                        })}
                    </div>

                    <div className="flex gap-1">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="px-2 py-1 text-xs bg-muted text-text-strong rounded-full hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-3 h-3 rtl:rotate-180" />
                        </button>

                        <span dir="ltr" className="px-2 py-1 text-xs text-text-strong">
                            {currentPage} / {totalPages}
                        </span>

                        <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="px-2 py-1 text-xs bg-muted text-text-strong rounded-full hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight className="w-3 h-3 rtl:rotate-180" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
