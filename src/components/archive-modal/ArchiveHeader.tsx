import { useState, useEffect } from 'react';
import { ArchiveFilters } from '../../types/archive';
import { Input } from '@/components/ui/input';
import { Search, Archive } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ArchiveHeaderProps {
    filters: ArchiveFilters;
    onFiltersChange: (filters: ArchiveFilters) => void;
}

export function ArchiveHeader({ filters, onFiltersChange }: ArchiveHeaderProps) {
    const { t } = useTranslation();
    const [searchTerm, setSearchTerm] = useState(filters.searchQuery || '');

    // Sync local state when filters change externally (e.g., Clear Search button)
    useEffect(() => {
        setSearchTerm(filters.searchQuery || '');
    }, [filters.searchQuery]);

    const handleSearchChange = (value: string) => {
        setSearchTerm(value);
        onFiltersChange({
            ...filters,
            searchQuery: value || undefined
        });
    };

    return (
        <div className="flex items-center justify-between gap-4 p-4 pe-14 border-b border-border">
            <h2 className="text-lg font-semibold text-text-strong whitespace-nowrap flex items-center gap-2">
                <Archive className="h-5 w-5" />
                {t('archive.page.title')}
            </h2>

            {/* Search Bar */}
            <div className="flex-1 max-w-xs relative">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-text-muted" />
                <Input
                    type="text"
                    placeholder={t('components.archive.searchPlaceholder')}
                    value={searchTerm}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    dir="auto"
                    className="ps-9"
                />
            </div>
        </div>
    );
}
