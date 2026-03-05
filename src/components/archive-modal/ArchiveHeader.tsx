import React, { useState, useEffect } from 'react';
import { ArchiveFilters } from '../../types/archive';
import { Input } from '@/components/ui/input';
import { Search, Archive } from 'lucide-react';

interface ArchiveHeaderProps {
    filters: ArchiveFilters;
    onFiltersChange: (filters: ArchiveFilters) => void;
}

export function ArchiveHeader({ filters, onFiltersChange }: ArchiveHeaderProps) {
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
        <div className="flex items-center justify-between gap-4 p-4 pr-14 border-b border-border">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap flex items-center gap-2">
                <Archive className="h-5 w-5" />
                Archive Management
            </h2>

            {/* Search Bar */}
            <div className="flex-1 max-w-xs relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                    type="text"
                    placeholder="Search archives..."
                    value={searchTerm}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9"
                />
            </div>
        </div>
    );
}
