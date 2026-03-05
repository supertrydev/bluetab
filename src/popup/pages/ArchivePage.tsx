import React, { useState, useEffect } from 'react';
import { ArchiveList } from '../components/archive/ArchiveList';
import { SearchFilters } from '../components/archive/SearchFilters';
import { ArchiveFilters, ArchivedGroup } from '../../types/archive';
import { ArchiveService } from '../../services/archive-service';
import { ArchiveViewModal } from '../components/archive/ArchiveViewModal';
import { ArrowLeft, Plus, Settings } from 'lucide-react';

interface ArchivePageProps {
    onBack: () => void;
}

export function ArchivePage({ onBack }: ArchivePageProps) {
    const [filters, setFilters] = useState<ArchiveFilters>({
        sortBy: 'date',
        sortOrder: 'desc'
    });
    const [stats, setStats] = useState({
        totalArchives: 0,
        protectedArchives: 0,
        totalSizeBytes: 0
    });
    const [viewModalOpen, setViewModalOpen] = useState(false);
    const [selectedArchive, setSelectedArchive] = useState<ArchivedGroup | null>(null);

    useEffect(() => {
        loadArchiveStats();
    }, []);

    const loadArchiveStats = async () => {
        try {
            const archiveStats = await ArchiveService.getArchiveStats();
            setStats({
                totalArchives: archiveStats.totalArchives,
                protectedArchives: archiveStats.protectedArchives,
                totalSizeBytes: archiveStats.totalSizeBytes
            });
        } catch (error) {
            console.error('Failed to load archive stats:', error);
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return '0MB';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
    };

    const handleArchiveView = (archive: ArchivedGroup) => {
        setSelectedArchive(archive);
        setViewModalOpen(true);
    };

    const handleCloseViewModal = () => {
        setViewModalOpen(false);
        setSelectedArchive(null);
    };

    return (
        <div className="archive-page">
            {/* Archive Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onBack}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title="Back to Groups"
                    >
                        <ArrowLeft className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    </button>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Archive Management
                    </h2>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => {
                            // Navigate back to options page where user can create new archives via dropdown
                            window.location.href = chrome.runtime.getURL('src/options/index.html');
                        }}
                        className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                    >
                        <Plus className="w-3 h-3 mr-1 inline" />
                        New Archive
                    </button>
                    <button
                        onClick={() => {
                            window.location.href = chrome.runtime.getURL('src/options/index.html#settings');
                        }}
                        className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                    >
                        <Settings className="w-3 h-3 mr-1 inline" />
                        Settings
                    </button>
                </div>
            </div>

            {/* Search and Filters */}
            <div className="mb-4">
                <SearchFilters
                    filters={filters}
                    onFiltersChange={setFilters}
                    totalArchives={stats.totalArchives}
                    protectedCount={stats.protectedArchives}
                />
            </div>

            {/* Archive Stats */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-center">
                    <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">{stats.totalArchives}</div>
                    <div className="text-xs text-blue-600 dark:text-blue-400">Total Archives</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
                    <div className="text-lg font-semibold text-green-700 dark:text-green-300">{stats.protectedArchives}</div>
                    <div className="text-xs text-green-600 dark:text-green-400">Protected</div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3 text-center">
                    <div className="text-lg font-semibold text-purple-700 dark:text-purple-300">{formatFileSize(stats.totalSizeBytes)}</div>
                    <div className="text-xs text-purple-600 dark:text-purple-400">Storage Used</div>
                </div>
            </div>

            {/* Archive List */}
            <div className="flex-1">
                <ArchiveList
                    onArchiveView={handleArchiveView}
                    filters={filters}
                    onFiltersChange={setFilters}
                />
            </div>

            {/* Archive View Modal */}
            <ArchiveViewModal
                isOpen={viewModalOpen}
                onClose={handleCloseViewModal}
                archive={selectedArchive}
            />
        </div>
    );
}