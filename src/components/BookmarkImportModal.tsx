import { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
    ChevronRight,
    ChevronDown,
    Folder,
    FolderOpen,
    Upload,
    Bookmark,
    AlertCircle,
} from 'lucide-react';
import type { TabGroup, Settings } from '../types/models';
import {
    parseChromeBookmarks,
    parseBookmarkHTML,
    convertToTabGroups,
    countBookmarks,
    type BookmarkNode,
} from '../services/bookmark-import-service';
import { Storage } from '../utils/storage';
import { ToastManager } from './Toast';

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FolderItemProps {
    node: BookmarkNode;
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
    depth: number;
}

function FolderItem({ node, selectedIds, onToggle, depth }: FolderItemProps) {
    const [expanded, setExpanded] = useState(depth < 1);
    const subFolders = (node.children || []).filter(c => c.children !== undefined);
    const bkCount = countBookmarks(node);
    const isSelected = selectedIds.has(node.id);

    return (
        <div>
            <div
                className="flex items-center gap-1 py-1 rounded hover:bg-accent/50 select-none"
                style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px' }}
            >
                {/* Expand / collapse toggle */}
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                    className="p-0.5 flex-shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                    style={{ visibility: subFolders.length > 0 ? 'visible' : 'hidden' }}
                >
                    {expanded
                        ? <ChevronDown className="w-3.5 h-3.5" />
                        : <ChevronRight className="w-3.5 h-3.5" />
                    }
                </button>

                {/* Checkbox + label (clicking either selects) */}
                <label className="flex items-center gap-1.5 flex-1 cursor-pointer min-w-0">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggle(node.id)}
                        className="w-4 h-4 flex-shrink-0 cursor-pointer accent-blue-500"
                    />
                    {expanded && subFolders.length > 0
                        ? <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        : <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    }
                    <span className="text-sm truncate">{node.title}</span>
                    <span className="text-xs text-muted-foreground ml-auto pl-2 flex-shrink-0 tabular-nums">
                        {bkCount}
                    </span>
                </label>
            </div>

            {expanded && subFolders.length > 0 && (
                <div>
                    {subFolders.map(child => (
                        <FolderItem
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

interface FolderTreeSectionProps {
    treeData: BookmarkNode[];
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
}

function FolderTreeSection({
    treeData,
    selectedIds,
    onToggle,
    onSelectAll,
    onDeselectAll,
}: FolderTreeSectionProps) {
    const folders = treeData.filter(n => n.children !== undefined);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                    {selectedIds.size} folder{selectedIds.size !== 1 ? 's' : ''} selected
                </span>
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onSelectAll}
                        className="text-xs text-primary hover:underline"
                    >
                        Select all
                    </button>
                    <span className="text-muted-foreground text-xs">·</span>
                    <button
                        type="button"
                        onClick={onDeselectAll}
                        className="text-xs text-primary hover:underline"
                    >
                        Deselect all
                    </button>
                </div>
            </div>

            <ScrollArea className="h-56 border border-border rounded-md">
                <div className="py-1">
                    {folders.map(node => (
                        <FolderItem
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

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface BookmarkImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    existingGroups: TabGroup[];
    settings: Settings;
    onImportComplete: (newGroups: TabGroup[]) => void;
}

export function BookmarkImportModal({
    isOpen,
    onClose,
    existingGroups,
    settings,
    onImportComplete,
}: BookmarkImportModalProps) {
    const [activeTab, setActiveTab] = useState<'browser' | 'file'>('browser');
    const [treeData, setTreeData] = useState<BookmarkNode[] | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [nestedMode, setNestedMode] = useState<'separate' | 'merge'>('separate');
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load Chrome bookmarks when browser tab is shown
    useEffect(() => {
        if (isOpen && activeTab === 'browser' && treeData === null && !loading) {
            loadChromeBookmarks();
        }
    }, [isOpen, activeTab]);

    const loadChromeBookmarks = async () => {
        setLoading(true);
        setError(null);
        try {
            const tree = await chrome.bookmarks.getTree();
            setTreeData(parseChromeBookmarks(tree));
        } catch {
            setError('Could not access browser bookmarks. Make sure the "bookmarks" permission is granted.');
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const html = event.target?.result as string;
                const nodes = parseBookmarkHTML(html);
                if (nodes.length === 0) {
                    setError('No bookmark folders found in this file. Make sure it is a valid browser bookmark export.');
                    return;
                }
                setTreeData(nodes);
                setSelectedIds(new Set());
            } catch {
                setError('Failed to parse bookmark file. Please export a valid HTML bookmark file from your browser.');
            }
        };
        reader.readAsText(file);
        // Allow re-selecting the same file
        e.target.value = '';
    };

    const toggleFolder = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const collectAllFolderIds = (nodes: BookmarkNode[]): string[] => {
        const ids: string[] = [];
        for (const n of nodes) {
            if (n.children !== undefined) {
                ids.push(n.id);
                ids.push(...collectAllFolderIds(n.children));
            }
        }
        return ids;
    };

    const selectAll = () => {
        if (!treeData) return;
        setSelectedIds(new Set(collectAllFolderIds(treeData)));
    };

    const deselectAll = () => setSelectedIds(new Set());

    const handleTabChange = (tab: string) => {
        setActiveTab(tab as 'browser' | 'file');
        setTreeData(null);
        setSelectedIds(new Set());
        setError(null);
    };

    // Memoize preview so we don't recompute on every keystroke
    const selectionKey = Array.from(selectedIds).sort().join(',');
    const preview = useMemo(() => {
        if (selectedIds.size === 0 || !treeData) return [];
        return convertToTabGroups(treeData, selectedIds, nestedMode, existingGroups, settings.duplicateHandling);
    }, [treeData, selectionKey, nestedMode, existingGroups, settings.duplicateHandling]);

    const previewTabCount = preview.reduce((s, g) => s + g.tabs.length, 0);

    const handleImport = async () => {
        if (preview.length === 0) return;
        setImporting(true);
        try {
            const currentGroups = await Storage.get<TabGroup[]>('groups') || [];
            const updatedGroups = [...currentGroups, ...preview];
            await Storage.set('groups', updatedGroups);
            onImportComplete(updatedGroups);
            ToastManager.getInstance().success(
                `Imported ${preview.length} group${preview.length !== 1 ? 's' : ''} (${previewTabCount} tabs)`
            );
            onClose();
        } catch (err) {
            ToastManager.getInstance().error('Import failed: ' + (err as Error).message);
        } finally {
            setImporting(false);
        }
    };

    const hasFolders = treeData && treeData.some(n => n.children !== undefined);

    return (
        <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Bookmark className="w-5 h-5 text-primary" />
                        Import Bookmarks
                    </DialogTitle>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <TabsList className="grid w-full grid-cols-2 mb-4">
                        <TabsTrigger value="browser">From Browser</TabsTrigger>
                        <TabsTrigger value="file">From HTML File</TabsTrigger>
                    </TabsList>

                    {/* ── Browser tab ── */}
                    <TabsContent value="browser" className="mt-0 space-y-3">
                        {loading && (
                            <div className="text-sm text-muted-foreground text-center py-8">
                                Loading bookmarks…
                            </div>
                        )}
                        {error && (
                            <div className="flex items-start gap-2 text-sm text-destructive">
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}
                        {!loading && !error && hasFolders && (
                            <FolderTreeSection
                                treeData={treeData!}
                                selectedIds={selectedIds}
                                onToggle={toggleFolder}
                                onSelectAll={selectAll}
                                onDeselectAll={deselectAll}
                            />
                        )}
                        {!loading && !error && treeData && !hasFolders && (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                No bookmark folders found.
                            </p>
                        )}
                    </TabsContent>

                    {/* ── HTML File tab ── */}
                    <TabsContent value="file" className="mt-0 space-y-3">
                        <div>
                            <Button asChild variant="outline" className="w-full">
                                <label className="cursor-pointer flex items-center gap-2">
                                    <Upload className="w-4 h-4" />
                                    Choose bookmark file (.html)
                                    <input
                                        type="file"
                                        accept=".html,.htm"
                                        onChange={handleFileUpload}
                                        className="hidden"
                                    />
                                </label>
                            </Button>
                            {error && (
                                <div className="flex items-start gap-2 text-sm text-destructive mt-2">
                                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}
                            {!treeData && !error && (
                                <p className="text-xs text-muted-foreground mt-2 text-center">
                                    Export from Chrome: Bookmark manager → ⋮ → Export bookmarks
                                </p>
                            )}
                        </div>

                        {hasFolders && (
                            <FolderTreeSection
                                treeData={treeData!}
                                selectedIds={selectedIds}
                                onToggle={toggleFolder}
                                onSelectAll={selectAll}
                                onDeselectAll={deselectAll}
                            />
                        )}
                    </TabsContent>
                </Tabs>

                {/* ── Nested mode options (shown only when a tree is loaded) ── */}
                {hasFolders && (
                    <>
                        <Separator />
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-foreground">
                                When a folder contains sub-folders:
                            </p>
                            <RadioGroup
                                value={nestedMode}
                                onValueChange={v => setNestedMode(v as 'separate' | 'merge')}
                                className="grid grid-cols-2 gap-2"
                            >
                                <div
                                    className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                                        nestedMode === 'separate'
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50'
                                    }`}
                                    onClick={() => setNestedMode('separate')}
                                >
                                    <RadioGroupItem value="separate" id="mode-separate" className="mt-0.5" />
                                    <Label htmlFor="mode-separate" className="cursor-pointer space-y-0.5">
                                        <div className="text-sm font-medium">Separate groups</div>
                                        <div className="text-xs text-muted-foreground">One group per folder</div>
                                    </Label>
                                </div>
                                <div
                                    className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                                        nestedMode === 'merge'
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/50'
                                    }`}
                                    onClick={() => setNestedMode('merge')}
                                >
                                    <RadioGroupItem value="merge" id="mode-merge" className="mt-0.5" />
                                    <Label htmlFor="mode-merge" className="cursor-pointer space-y-0.5">
                                        <div className="text-sm font-medium">Merge into one</div>
                                        <div className="text-xs text-muted-foreground">Flatten all bookmarks</div>
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                    </>
                )}

                <DialogFooter className="flex items-center gap-2 pt-1">
                    {preview.length > 0 && (
                        <span className="text-xs text-muted-foreground flex-1">
                            {preview.length} group{preview.length !== 1 ? 's' : ''}, {previewTabCount} tab{previewTabCount !== 1 ? 's' : ''}
                        </span>
                    )}
                    <Button variant="secondary" onClick={onClose} disabled={importing}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleImport}
                        disabled={preview.length === 0 || importing}
                    >
                        {importing
                            ? 'Importing…'
                            : preview.length > 0
                                ? `Import ${preview.length} Group${preview.length !== 1 ? 's' : ''}`
                                : 'Import'
                        }
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
