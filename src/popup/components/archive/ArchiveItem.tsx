import React, { useState } from 'react';
import { ArchivedGroup } from '../../../types/archive';

interface ArchiveItemProps {
    archive: ArchivedGroup;
    onSelect?: (archive: ArchivedGroup) => void;
    onRestore?: (archive: ArchivedGroup) => void;
    onView?: (archive: ArchivedGroup) => void;
    onDelete?: (archive: ArchivedGroup) => void;
    isSelected?: boolean;
    showActions?: boolean;
}

export function ArchiveItem({
    archive,
    onSelect,
    onRestore,
    onView,
    onDelete,
    isSelected = false,
    showActions = true
}: ArchiveItemProps) {
    const [isHovered, setIsHovered] = useState(false);

    const formatDate = (timestamp: number) => {
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(timestamp));
    };

    const getGroupName = (archive: ArchivedGroup): string => {
        if (typeof archive.originalGroup === 'string') {
            return 'Protected Archive';
        }
        return archive.originalGroup.name;
    };

    const getTabCount = (archive: ArchivedGroup): number => {
        if (typeof archive.originalGroup === 'string') {
            return 0; // Can't count tabs in encrypted data
        }
        return archive.originalGroup.tabs.length;
    };

    const getPreviewTabs = (archive: ArchivedGroup) => {
        if (typeof archive.originalGroup === 'string') {
            return [];
        }
        return archive.originalGroup.tabs.slice(0, 3);
    };

    const handleClick = () => {
        if (onView) {
            onView(archive);
        }
    };

    const handleRestore = (e: React.MouseEvent) => {
        e.stopPropagation();
        onRestore?.(archive);
    };

    const handleView = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onView) {
            onView(archive);
        }
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete?.(archive);
    };

    return (
        <div
            onClick={handleClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`
                border rounded-lg p-3 sm:p-4 transition-all duration-200 cursor-pointer
                ${isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-border bg-bg-1'
                }
                ${isHovered
                    ? 'shadow-md sm:transform sm:scale-[1.02]'
                    : 'shadow-sm'
                }
                hover:bg-gray-50 dark:hover:bg-gray-700
            `}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-3">
                        <h3 className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                            {getGroupName(archive)}
                        </h3>

                        {/* Status Indicators */}
                        <div className="flex items-center gap-1">
                            {archive.protection.passwordProtected && (
                                <i
                                    className="fas fa-lock text-xs text-yellow-500"
                                    title="Password Protected"
                                ></i>
                            )}

                            {archive.metadata.restoredCount > 0 && (
                                <i
                                    className="fas fa-undo text-xs text-green-500"
                                    title={`Restored ${archive.metadata.restoredCount} times`}
                                ></i>
                            )}
                        </div>
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 mb-3">
                        <span title="Archive Date" className="flex items-center gap-1.5">
                            <i className="fas fa-calendar"></i>
                            {formatDate(archive.metadata.archivedDate)}
                        </span>

                        <span title="Tab Count" className="flex items-center gap-1.5">
                            <i className="fas fa-folder-open"></i>
                            {getTabCount(archive)} tabs
                        </span>
                    </div>

                    {/* Archive Reason */}
                    {archive.metadata.archiveReason && (
                        <p
                            className="text-xs text-gray-600 dark:text-gray-300 mb-3 italic"
                            title={archive.metadata.archiveReason}
                        >
                            "{archive.metadata.archiveReason}"
                        </p>
                    )}

                    {/* Tab Preview */}
                    {!archive.protection.passwordProtected && (
                        <div className="space-y-1.5">
                            {getPreviewTabs(archive).map((tab, index) => (
                                <div key={index} className="flex items-center gap-2 text-xs py-1">
                                    <img
                                        src={tab.favicon || '/icons/default-favicon.png'}
                                        alt=""
                                        className="w-3 h-3 flex-shrink-0"
                                        onError={(e) => {
                                            e.currentTarget.src = '/icons/default-favicon.png';
                                        }}
                                    />
                                    <span
                                        className="truncate text-gray-600 dark:text-gray-400"
                                        title={tab.title}
                                    >
                                        {tab.title}
                                    </span>
                                </div>
                            ))}

                            {getTabCount(archive) > 3 && (
                                <p className="text-xs text-gray-500 dark:text-gray-400 pl-5">
                                    +{getTabCount(archive) - 3} more tabs
                                </p>
                            )}
                        </div>
                    )}

                    {/* Last Accessed */}
                    {archive.metadata.lastAccessed && (
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                            Last accessed: {formatDate(archive.metadata.lastAccessed)}
                        </div>
                    )}
                </div>

                {/* Actions */}
                {showActions && (
                    <div className={`flex items-center gap-2 ml-2 transition-opacity duration-200 ${
                        isHovered ? 'opacity-100' : 'opacity-60'
                    }`}>
                        <button
                            onClick={handleView}
                            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                            title="View Archive"
                        >
                            <i className="fas fa-eye"></i>
                        </button>

                        <button
                            onClick={handleRestore}
                            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center text-xs bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                            title="Restore Archive"
                        >
                            <i className="fas fa-undo"></i>
                        </button>

                        <button
                            onClick={handleDelete}
                            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                            title="Delete Archive"
                        >
                            <i className="fas fa-trash"></i>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
