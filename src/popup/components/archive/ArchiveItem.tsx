import { useState } from 'react';
import { Lock, RotateCcw, Calendar, FolderOpen, Eye, Trash2 } from 'lucide-react';
import { formatDateTime } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import { ArchivedGroup } from '../../../types/archive';
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
    const [isHovered, setIsHovered] = useState(false);

    const formatDate = (timestamp: number) => {
        return formatDateTime(timestamp);
    };

    const getGroupName = (archive: ArchivedGroup): string => {
        if (typeof archive.originalGroup === 'string') {
            return t('archive.item.protectedArchive');
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
        onSelect?.(archive);
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
                    ? 'border-primary bg-primary-muted'
                    : 'border-border bg-bg-1'
                }
                ${isHovered
                    ? 'shadow-md sm:transform sm:scale-[1.02]'
                    : 'shadow-sm'
                }
                hover:bg-accent
            `}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-3">
                        <h3 className="font-medium text-sm text-text-strong truncate">
                            <bdi dir="auto">{getGroupName(archive)}</bdi>
                        </h3>

                        {/* Status Indicators */}
                        <div className="flex items-center gap-1">
                            {archive.protection.passwordProtected && (
                                <Lock
                                    className="w-3 h-3 text-warning"
                                    aria-label={t('archive.item.passwordProtected')}
                                />
                            )}

                            {archive.metadata.restoredCount > 0 && (
                                <RotateCcw
                                    className="w-3 h-3 text-success"
                                    aria-label={t('archive.item.restoredCount', { count: archive.metadata.restoredCount })}
                                />
                            )}
                        </div>
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center gap-4 text-xs text-text-muted mb-3">
                        <span dir="ltr" title={t('archive.item.archiveDate')} className="flex items-center gap-1.5">
                            <Calendar className="w-3 h-3" />
                            {formatDate(archive.metadata.archivedDate)}
                        </span>

                        <span title={t('archive.item.tabCount')} className="flex items-center gap-1.5">
                            <FolderOpen className="w-3 h-3" />
                            {t('archive.item.tabsCount', { count: getTabCount(archive) })}
                        </span>
                    </div>

                    {/* Archive Reason */}
                    {archive.metadata.archiveReason && (
                        <p
                            className="text-xs text-text-muted mb-3 italic"
                            title={archive.metadata.archiveReason}
                        >
                            <bdi dir="auto">"{archive.metadata.archiveReason}"</bdi>
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
                                        className="truncate text-text-muted"
                                        title={isolateBidi(tab.title)}
                                    >
                                        <bdi dir="auto">{tab.title}</bdi>
                                    </span>
                                </div>
                            ))}

                            {getTabCount(archive) > 3 && (
                                <p className="text-xs text-text-muted ps-5">
                                    {t('archive.item.moreTabs', { count: getTabCount(archive) - 3 })}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Last Accessed */}
                    {archive.metadata.lastAccessed && (
                        <div className="text-xs text-text-muted mt-2">
                            {t('archive.item.lastAccessed', {
                                date: isolateBidi(formatDate(archive.metadata.lastAccessed), 'ltr'),
                            })}
                        </div>
                    )}
                </div>

                {/* Actions */}
                {showActions && (
                    <div className={`flex items-center gap-2 ms-2 transition-opacity duration-200 ${
                        isHovered ? 'opacity-100' : 'opacity-60'
                    }`}>
                        <button
                            onClick={handleView}
                            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center text-xs bg-primary text-white rounded hover:bg-primary-hover transition-colors"
                            title={t('archive.item.viewArchive')}
                        >
                            <Eye className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleRestore}
                            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center text-xs bg-success text-white rounded hover:bg-success transition-colors"
                            title={t('archive.item.restoreArchive')}
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>

                        <button
                            onClick={handleDelete}
                            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center text-xs bg-danger text-white rounded hover:bg-danger transition-colors"
                            title={t('archive.item.deleteArchive')}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
