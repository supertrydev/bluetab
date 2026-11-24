import { useCallback, useEffect, useMemo, useState } from 'react';
import { toLocalDateKey } from '@/utils/local-date';
import { Button } from '@/components/ui/button';
import { ToastManager } from '@/components/Toast';
import { getLanguageDirection, getLocaleTag, t as translate } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { formatDate, formatDateTime } from '@/i18n/format';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Label } from '@/components/ui/label';
import {
    ModalTemplate,
    ModalTemplateMetric,
    ModalTemplateMetricGrid,
    ModalTemplateSection,
} from '@/components/ui/modal-template';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Storage } from '@/utils/storage';
import { buildHtmlExport } from '../html-export';
import type { Project, Settings, TabGroup, Tag } from '@/types/models';
import type { FlowSettings } from '@/types/flow';
import {
    AlertCircle,
    Bookmark,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Download,
    FileCode,
    FileJson,
    Files,
    Folder,
    FolderOpen,
    Shield,
    Trash2,
    Upload,
} from 'lucide-react';
import {
    analyzeImportFile,
    type ImportAnalysis,
} from '@/services/import-format-service';
import {
    formatBlueTabBackupImportSuccess,
    importBlueTabBackup,
} from '@/services/bluetab-backup-import-service';
import { CWSReviewPromptService } from '@/services/cws-review-prompt-service';
import {
    convertToTabGroups,
    countBookmarks,
    parseChromeBookmarks,
    type BookmarkNode,
} from '@/services/bookmark-import-service';
import { ArchiveStorageService } from '@/utils/archive-storage';
import { canAccessFeature } from '@/utils/feature-gate';
import { FlowStorageService } from '@/utils/flow-storage';
import { GroupMemoryStorageService } from '@/utils/group-memory-storage';
import { useTranslation } from 'react-i18next';

export interface BackupSettingsProps {
    settings: Settings;
    groups: TabGroup[];
    onSettingsChange: (updated: Settings) => void;
    onGroupsChange: (groups: TabGroup[]) => void;
}

interface BookmarkFolderItemProps {
    node: BookmarkNode;
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
    depth: number;
}

function BookmarkFolderItem({ node, selectedIds, onToggle, depth }: BookmarkFolderItemProps) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(depth < 1);
    const subFolders = (node.children || []).filter((child) => child.children !== undefined);
    const isSelected = selectedIds.has(node.id);
    const bookmarkCount = countBookmarks(node);

    return (
        <div>
            <div
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent"
                style={{ paddingInlineStart: `${8 + depth * 16}px` }}
            >
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setExpanded((value) => !value);
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-strong"
                    aria-label={expanded ? t('settings.backup.collapseFolder') : t('settings.backup.expandFolder')}
                    style={{ visibility: subFolders.length > 0 ? 'visible' : 'hidden' }}
                >
                    {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
                </button>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(node.id)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    />
                    {expanded && subFolders.length > 0
                        ? <FolderOpen className="h-4 w-4 shrink-0 text-warning" />
                        : <Folder className="h-4 w-4 shrink-0 text-warning" />
                    }
                    <bdi dir="auto" className="truncate text-sm text-text-strong">{node.title}</bdi>
                    <span dir="ltr" className="ms-auto shrink-0 text-xs tabular-nums text-text-muted">{bookmarkCount}</span>
                </label>
            </div>
            {expanded && subFolders.length > 0 && (
                <div>
                    {subFolders.map((child) => (
                        <BookmarkFolderItem
                            key={child.id}
                            node={child}
                            selectedIds={selectedIds}
                            onToggle={onToggle}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface BookmarkFolderTreeProps {
    treeData: BookmarkNode[];
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
}

function BookmarkFolderTree({
    treeData,
    selectedIds,
    onToggle,
    onSelectAll,
    onDeselectAll,
}: BookmarkFolderTreeProps) {
    const { t } = useTranslation();
    const folders = treeData.filter((node) => node.children !== undefined);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-text-muted">
                    {t('settings.backup.selectedFolders', { count: selectedIds.size })}
                </span>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={onSelectAll} className="text-xs text-primary hover:underline">
                        {t('settings.backup.selectAll')}
                    </button>
                    <span className="text-xs text-text-muted">/</span>
                    <button type="button" onClick={onDeselectAll} className="text-xs text-primary hover:underline">
                        {t('settings.backup.deselectAll')}
                    </button>
                </div>
            </div>

            <ScrollArea className="h-56 rounded-lg border border-border bg-bg-1/60">
                <div className="py-1">
                    {folders.map((node) => (
                        <BookmarkFolderItem
                            key={node.id}
                            node={node}
                            selectedIds={selectedIds}
                            onToggle={onToggle}
                            depth={0}
                        />
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

function collectBookmarkFolderIds(nodes: BookmarkNode[]): string[] {
    const ids: string[] = [];
    for (const node of nodes) {
        if (node.children !== undefined) {
            ids.push(node.id);
            ids.push(...collectBookmarkFolderIds(node.children));
        }
    }
    return ids;
}

export function BackupSettings({ settings, groups, onSettingsChange, onGroupsChange }: BackupSettingsProps) {
    const { t } = useTranslation();
    const [showClearModal, setShowClearModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importPreview, setImportPreview] = useState<ImportAnalysis | null>(null);
    const [importFileName, setImportFileName] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [importSource, setImportSource] = useState<'file' | 'browser'>('file');
    const [bookmarkTree, setBookmarkTree] = useState<BookmarkNode[] | null>(null);
    const [selectedBookmarkIds, setSelectedBookmarkIds] = useState<Set<string>>(new Set());
    const [bookmarkNestedMode, setBookmarkNestedMode] = useState<'separate' | 'merge'>('separate');
    const [bookmarkLoading, setBookmarkLoading] = useState(false);
    const [bookmarkError, setBookmarkError] = useState<string | null>(null);

    const exportData = async () => {
        try {
            const allTags = await Storage.get<Tag[]>('tags') || [];
            const pinSettings = await Storage.getPinSettings();

            let archives = {};
            try {
                const archiveData = await ArchiveStorageService.getArchives();
                archives = archiveData.archives || {};
            } catch (archiveError) {
                console.warn('Could not export archives:', archiveError);
            }

            let textSettings = null;
            try {
                const syncResult = await chrome.storage.sync.get('bluetab_text_size_settings');
                textSettings = syncResult.bluetab_text_size_settings || null;
            } catch (textError) {
                console.warn('Could not export text settings:', textError);
            }

            const layoutMode = await Storage.get<string>('layoutMode') || 'masonry';
            const collapsedGroups = await Storage.get<Record<string, boolean>>('collapsedGroups') || {};

            let flowSettings: FlowSettings | null = null;
            try {
                const accessResult = await canAccessFeature('flow');
                if (accessResult.allowed) {
                    const storedFlowSettings = await FlowStorageService.getFlowSettings();
                    if (storedFlowSettings.rules && storedFlowSettings.rules.length > 0) {
                        flowSettings = storedFlowSettings;
                        console.log(`[BlueTab][Export] Including ${storedFlowSettings.rules.length} Flow rules`);
                    }
                }
            } catch (flowError) {
                console.warn('Could not export Flow settings:', flowError);
            }

            let groupMemory = null;
            try {
                const memoryData = await GroupMemoryStorageService.getMemory();
                if (Object.keys(memoryData.groups).length > 0) {
                    groupMemory = memoryData;
                    console.log(`[BlueTab][Export] Including ${Object.keys(memoryData.groups).length} remembered groups`);
                }
            } catch (memoryError) {
                console.warn('Could not export group memory:', memoryError);
            }

            const projects = await Storage.getProjects();

            const data = {
                groups,
                tags: allTags,
                settings,
                pinSettings,
                archives,
                textSettings,
                layoutMode,
                collapsedGroups,
                flowSettings,
                groupMemory,
                projects,
                exportedAt: Date.now(),
                version: '2.3.0'
            };

            console.log('Exporting comprehensive backup:', {
                groups: groups.length,
                tags: allTags.length,
                archives: Object.keys(archives).length,
                settings: Object.keys(settings).length,
                flowRules: flowSettings?.rules?.length || 0,
                groupMemory: groupMemory ? Object.keys(groupMemory.groups).length : 0,
                projects: projects.length
            });

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bluetab-backup-${toLocalDateKey()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            ToastManager.getInstance().success(t('components.backupStatus.exportComplete'));
        } catch (error) {
            console.error('Failed to export data:', error);
            ToastManager.getInstance().error(t('components.backupStatus.exportFailed', { message: isolateBidi((error as Error).message) }));
        }
    };

    const exportAsHTML = async () => {
        try {
            const [tags, projects] = await Promise.all([
                Storage.get<Tag[]>('tags'),
                Storage.get<Project[]>('projects'),
            ]);
            const theme = settings.theme === 'dark' || settings.theme === 'light'
                ? settings.theme
                : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            const locale = getLocaleTag();
            const now = new Date();
            const html = buildHtmlExport({
                groups,
                tags: tags ?? [],
                projects: projects ?? [],
                theme,
                locale,
                direction: getLanguageDirection(locale),
                labels: {
                    title: translate('settings.backup.exportTitle'),
                    groups: translate('settings.backup.groups'),
                    totalTabs: translate('settings.backup.totalTabs'),
                    emptyGroup: translate('settings.backup.noTabsInGroup'),
                    untitled: t('settings.integrations.untitled'),
                    exportedFrom: translate('settings.backup.exportedFrom'),
                },
                dateLabel: new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now),
                exportedAt: formatDateTime(now),
                tabsCount: (count) => translate('common.tabsCount', { count }),
                formatDate: (timestamp) => formatDate(timestamp),
                formatNumber: (value) => new Intl.NumberFormat(locale).format(value),
            });

            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bluetab-export-${toLocalDateKey()}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            ToastManager.getInstance().success(t('components.backupStatus.htmlComplete'));
        } catch (error) {
            console.error('Failed to export as HTML:', error);
            ToastManager.getInstance().error(t('components.backupStatus.htmlFailed', { message: isolateBidi((error as Error).message) }));
        }
    };

    const loadBrowserBookmarks = useCallback(async () => {
        setBookmarkLoading(true);
        setBookmarkError(null);
        try {
            // Request first (no awaited contains): Firefox only allows the
            // prompt during user input. Already granted → resolves true.
            const granted = await chrome.permissions.request({ permissions: ['bookmarks'] });
            if (!granted) {
                setBookmarkError(t('components.backupStatus.bookmarkPermissionRequired'));
                setBookmarkTree(null);
                return;
            }

            const tree = await chrome.bookmarks.getTree();
            setBookmarkTree(parseChromeBookmarks(tree));
            setSelectedBookmarkIds(new Set());
        } catch {
            setBookmarkError(t('components.backupStatus.bookmarksUnavailable'));
            setBookmarkTree(null);
        } finally {
            setBookmarkLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (showImportModal && importSource === 'browser' && bookmarkTree === null && !bookmarkLoading) {
            void loadBrowserBookmarks();
        }
    }, [showImportModal, importSource, bookmarkTree, bookmarkLoading, loadBrowserBookmarks]);

    const toggleBookmarkFolder = (id: string) => {
        setSelectedBookmarkIds((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllBookmarkFolders = () => {
        if (!bookmarkTree) return;
        setSelectedBookmarkIds(new Set(collectBookmarkFolderIds(bookmarkTree)));
    };

    const deselectAllBookmarkFolders = () => {
        setSelectedBookmarkIds(new Set());
    };

    const bookmarkPreviewGroups = useMemo(() => {
        if (!bookmarkTree || selectedBookmarkIds.size === 0) return [];
        return convertToTabGroups(
            bookmarkTree,
            selectedBookmarkIds,
            bookmarkNestedMode,
            groups,
            settings.duplicateHandling,
        );
    }, [bookmarkTree, selectedBookmarkIds, bookmarkNestedMode, groups, settings.duplicateHandling]);

    const bookmarkPreviewTabCount = bookmarkPreviewGroups.reduce((sum, group) => sum + group.tabs.length, 0);
    const hasBookmarkFolders = Boolean(bookmarkTree?.some((node) => node.children !== undefined));

    const resetImportModal = () => {
        setImportPreview(null);
        setImportFileName('');
        setIsImporting(false);
        setImportSource('file');
        setBookmarkTree(null);
        setSelectedBookmarkIds(new Set());
        setBookmarkNestedMode('separate');
        setBookmarkLoading(false);
        setBookmarkError(null);
    };

    const closeImportModal = () => {
        setShowImportModal(false);
        resetImportModal();
    };

    const handleImportFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (readerEvent) => {
            const content = String(readerEvent.target?.result || '');
            const preview = analyzeImportFile({
                fileName: file.name,
                content,
                existingGroups: groups,
                duplicateHandling: settings.duplicateHandling,
            });
            setImportFileName(file.name);
            setImportPreview(preview);
        };
        reader.onerror = () => {
            setImportFileName(file.name);
            setImportPreview({
                format: 'unsupported',
                label: t('components.backupStatus.unsupported'),
                groupCount: 0,
                tabCount: 0,
                skippedInvalidUrls: [],
                skippedDuplicates: [],
                warnings: [],
                error: t('components.backupStatus.fileReadFailed'),
            });
        };
        reader.readAsText(file);
    };

    const handleImportConfirm = async () => {
        const filePreview = importPreview;
        if (importSource === 'file' && (!filePreview || filePreview.format === 'unsupported')) return;
        if (importSource === 'browser' && bookmarkPreviewGroups.length === 0) return;

        setIsImporting(true);
        try {
            if (importSource === 'browser') {
                const currentGroups = await Storage.get<TabGroup[]>('groups') || [];
                const updatedGroups = [...currentGroups, ...bookmarkPreviewGroups];
                await Storage.set('groups', updatedGroups);
                onGroupsChange(updatedGroups);
                await CWSReviewPromptService.recordImportCompleted(bookmarkPreviewTabCount);
                ToastManager.getInstance().success(
                    t('settings.backup.importedGroups', { count: bookmarkPreviewGroups.length, tabs: bookmarkPreviewTabCount })
                );
            } else if (filePreview?.format === 'bluetab-backup') {
                const result = await importBlueTabBackup(filePreview.backupData);
                onGroupsChange(result.updatedGroups);
                if (result.updatedSettings) {
                    onSettingsChange(result.updatedSettings);
                }
                await CWSReviewPromptService.recordImportCompleted(result.tabCount);
                ToastManager.getInstance().success(formatBlueTabBackupImportSuccess(result));
            } else {
                if (!filePreview || filePreview.format === 'unsupported') return;
                const groupsToImport = filePreview.groups || [];
                const currentGroups = await Storage.get<TabGroup[]>('groups') || [];
                const updatedGroups = [...currentGroups, ...groupsToImport];
                await Storage.set('groups', updatedGroups);
                onGroupsChange(updatedGroups);
                await CWSReviewPromptService.recordImportCompleted(filePreview.tabCount);
                ToastManager.getInstance().success(
                    t('settings.backup.importedGroups', { count: filePreview.groupCount, tabs: filePreview.tabCount })
                );
            }
            closeImportModal();
        } catch (error) {
            console.error('Import failed:', error);
            ToastManager.getInstance().error(t('settings.backup.importFailed', { message: isolateBidi((error as Error).message) }));
        } finally {
            setIsImporting(false);
        }
    };

    const canConfirmImport = importSource === 'browser'
        ? bookmarkPreviewGroups.length > 0
        : Boolean(importPreview && importPreview.format !== 'unsupported');

    const importButtonText = isImporting
        ? t('settings.backup.importing')
        : importSource === 'browser' && bookmarkPreviewGroups.length > 0
            ? t('settings.backup.importGroupButton', { count: bookmarkPreviewGroups.length })
            : t('settings.backup.import');

    const handleClearConfirm = async () => {
        try {
            await Storage.set('groups', []);
            onGroupsChange([]);
            await Storage.set('tags', []);

            try {
                await ArchiveStorageService.clearAllArchives();
            } catch (archiveError) {
                console.warn('Could not clear archives:', archiveError);
            }

            try {
                await FlowStorageService.clearAll();
                console.log('[BlueTab][Settings] Flow data cleared');
            } catch (flowError) {
                console.warn('Could not clear Flow settings:', flowError);
            }

            await Storage.set('pinSettings', { pinnedGroups: {} });
            ToastManager.getInstance().success(t('components.backupStatus.clearComplete'));
        } catch (error) {
            ToastManager.getInstance().error(t('components.backupStatus.clearFailed', { message: isolateBidi((error as Error).message) }));
        }
        setShowClearModal(false);
    };

    return (
        <>
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <Shield className="w-5 h-5" />
                    {t('components.backupStatus.title')}
                </h3>

                <div className="flex flex-wrap gap-3">
                    <Button
                        onClick={exportData}
                        className="flex-none"
                    >
                        <Download className="w-4 h-4" />
                        {t('settings.backup.exportBackup')}
                    </Button>

                    <Button
                        onClick={exportAsHTML}
                        variant="secondary"
                        className="flex-none"
                    >
                        <FileCode className="w-4 h-4" />
                        {t('settings.backup.exportHtml')}
                    </Button>

                    <Button
                        onClick={() => setShowImportModal(true)}
                        variant="secondary"
                        className="flex-none"
                    >
                        <Upload className="w-4 h-4" />
                        {t('settings.backup.importBackup')}
                    </Button>

                    <Button
                        onClick={() => setShowClearModal(true)}
                        variant="danger"
                        className="flex-none"
                    >
                        <Trash2 className="w-4 h-4" />
                        {t('settings.backup.clearAllData')}
                    </Button>
                </div>
            </div>

            <ConfirmModal
                isOpen={showClearModal}
                title={t('settings.backup.clearAllData')}
                message={t('settings.backup.clearAllMessage')}
                confirmText={t('settings.backup.deleteAll')}
                cancelText={t('common.cancel')}
                onConfirm={handleClearConfirm}
                onCancel={() => setShowClearModal(false)}
                type="danger"
            />

            <ModalTemplate
                open={showImportModal}
                onOpenChange={(open) => !open && closeImportModal()}
                className="sm:max-w-xl"
                heading={t('settings.backup.importBackup')}
                titleIcon={<Upload className="h-5 w-5 text-primary" />}
                description={t('settings.backup.importDescription')}
                footer={(
                    <>
                        <Button variant="secondary" onClick={closeImportModal} disabled={isImporting}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            onClick={handleImportConfirm}
                            disabled={!canConfirmImport || isImporting}
                        >
                            {importButtonText}
                        </Button>
                    </>
                )}
            >
                    <Tabs value={importSource} onValueChange={(value) => setImportSource(value as 'file' | 'browser')}>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="file">{t('settings.backup.backupFile')}</TabsTrigger>
                            <TabsTrigger value="browser">{t('settings.backup.browserBookmarks')}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="file" className="mt-4 space-y-4">
                            <Button asChild variant="outline" className="w-full">
                                <label className="cursor-pointer">
                                    <Files className="h-4 w-4" />
                                    {t('settings.backup.chooseFile')}
                                    <input
                                        type="file"
                                        accept=".json,.html,.htm,.txt"
                                        onChange={handleImportFileSelect}
                                        className="hidden"
                                    />
                                </label>
                            </Button>

                            {importFileName && (
                                <ModalTemplateSection className="rounded-lg">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                            {importPreview?.format === 'bluetab-backup'
                                                ? <FileJson className="h-4 w-4" />
                                                : importPreview?.format === 'unsupported'
                                                    ? <AlertCircle className="h-4 w-4 text-danger" />
                                                    : <CheckCircle2 className="h-4 w-4" />
                                            }
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <bdi dir="auto" className="truncate text-sm font-medium text-text-strong">{importFileName}</bdi>
                                                {importPreview && (
                                                    <span className="rounded-full bg-bg-2 px-2 py-0.5 text-xs text-text-muted">
                                                        <bdi dir="auto">{importPreview.label}</bdi>
                                                    </span>
                                                )}
                                            </div>

                                            {importPreview?.format === 'unsupported' ? (
                                                <p dir="auto" className="mt-2 text-sm text-danger">
                                                    {importPreview.error}
                                                </p>
                                            ) : importPreview ? (
                                                <div className="mt-3 space-y-3">
                                                    <ModalTemplateMetricGrid>
                                                        <ModalTemplateMetric label={t('settings.backup.groups')} value={<bdi dir="ltr">{importPreview.groupCount}</bdi>} />
                                                        <ModalTemplateMetric label={t('sidepanel.tabs')} value={<bdi dir="ltr">{importPreview.tabCount}</bdi>} />
                                                    </ModalTemplateMetricGrid>

                                                    {importPreview.warnings.map((warning) => (
                                                        <p key={warning} dir="auto" className="text-xs text-text-muted">{warning}</p>
                                                    ))}

                                                    {(importPreview.skippedInvalidUrls.length > 0 || importPreview.skippedDuplicates.length > 0) && (
                                                        <div className="rounded-md border border-warning/30 bg-warning-muted p-3 text-xs text-warning">
                                                            {importPreview.skippedInvalidUrls.length > 0 && (
                                                                <p>
                                                                    {t('components.backupStatus.skippedInvalid', { count: importPreview.skippedInvalidUrls.length })}
                                                                </p>
                                                            )}
                                                            {importPreview.skippedDuplicates.length > 0 && (
                                                                <p>
                                                                    {t('components.backupStatus.skippedDuplicate', { count: importPreview.skippedDuplicates.length })}
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                </ModalTemplateSection>
                            )}
                        </TabsContent>

                        <TabsContent value="browser" className="mt-4 space-y-4">
                            {bookmarkLoading && (
                                <div className="rounded-lg border border-border bg-bg-1/60 p-6 text-center text-sm text-text-muted">
                                    {t('components.backupStatus.loadingBookmarks')}
                                </div>
                            )}

                            {bookmarkError && (
                                <div className="rounded-lg border border-danger/30 bg-danger-muted p-4">
                                    <div className="flex items-start gap-2 text-sm text-danger">
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span dir="auto">{bookmarkError}</span>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={loadBrowserBookmarks} className="mt-3">
                                        {t('common.repeat')}
                                    </Button>
                                </div>
                            )}

                            {!bookmarkLoading && !bookmarkError && !bookmarkTree && (
                                <Button variant="outline" onClick={loadBrowserBookmarks} className="w-full">
                                    <Bookmark className="h-4 w-4" />
                                    {t('settings.backup.loadBrowserBookmarks')}
                                </Button>
                            )}

                            {!bookmarkLoading && !bookmarkError && bookmarkTree && !hasBookmarkFolders && (
                                <div className="rounded-lg border border-border bg-bg-1/60 p-6 text-center text-sm text-text-muted">
                                    {t('settings.backup.noBookmarkFolders')}
                                </div>
                            )}

                            {!bookmarkLoading && !bookmarkError && bookmarkTree && hasBookmarkFolders && (
                                <>
                                    <BookmarkFolderTree
                                        treeData={bookmarkTree}
                                        selectedIds={selectedBookmarkIds}
                                        onToggle={toggleBookmarkFolder}
                                        onSelectAll={selectAllBookmarkFolders}
                                        onDeselectAll={deselectAllBookmarkFolders}
                                    />

                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-text-strong">{t('settings.backup.subfolderBehavior')}</p>
                                        <RadioGroup
                                            value={bookmarkNestedMode}
                                            onValueChange={(value) => setBookmarkNestedMode(value as 'separate' | 'merge')}
                                            className="grid grid-cols-2 gap-2"
                                        >
                                            <label
                                                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                                                    bookmarkNestedMode === 'separate'
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-border hover:border-primary/50'
                                                }`}
                                            >
                                                <RadioGroupItem value="separate" id="bookmark-mode-separate" className="mt-0.5" />
                                                <span className="space-y-0.5">
                                                    <Label htmlFor="bookmark-mode-separate" className="cursor-pointer text-sm font-medium">
                                                        {t('settings.backup.separateGroups')}
                                                    </Label>
                                                    <span className="block text-xs text-text-muted">{t('settings.backup.oneGroupPerFolder')}</span>
                                                </span>
                                            </label>
                                            <label
                                                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                                                    bookmarkNestedMode === 'merge'
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-border hover:border-primary/50'
                                                }`}
                                            >
                                                <RadioGroupItem value="merge" id="bookmark-mode-merge" className="mt-0.5" />
                                                <span className="space-y-0.5">
                                                    <Label htmlFor="bookmark-mode-merge" className="cursor-pointer text-sm font-medium">
                                                        {t('settings.backup.mergeIntoOne')}
                                                    </Label>
                                                    <span className="block text-xs text-text-muted">{t('settings.backup.flattenBookmarks')}</span>
                                                </span>
                                            </label>
                                        </RadioGroup>
                                    </div>

                                    <ModalTemplateMetricGrid>
                                        <ModalTemplateMetric label={t('settings.backup.groups')} value={<bdi dir="ltr">{bookmarkPreviewGroups.length}</bdi>} />
                                        <ModalTemplateMetric label={t('sidepanel.tabs')} value={<bdi dir="ltr">{bookmarkPreviewTabCount}</bdi>} />
                                    </ModalTemplateMetricGrid>
                                </>
                            )}
                        </TabsContent>
                    </Tabs>
            </ModalTemplate>
        </>
    );
}
