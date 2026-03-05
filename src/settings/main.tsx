import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeManager, type Theme } from '../utils/theme';
import { Storage } from '../utils/storage';
import { getDefaultSettings, getDefaultGroupMenuConfig, getNormalizedGroupMenuConfig, type SortOrder, SORT_OPTIONS } from '../utils/sorting';
import type { GroupMenuSubmenuItem, Settings, TabGroup, Tag, Project } from '../types/models';
import type { FlowSettings } from '../types/flow';
import TextSizeSetting from '../components/TextSizeSetting';
import { textSizeService } from '../utils/TextSizeService';
import { ToastManager } from '../components/Toast';
import { ConfirmModal } from '../components/ConfirmModal';
import { BookmarkImportModal } from '../components/BookmarkImportModal';
import { Toaster } from 'sonner';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Sun, Moon, Trash2, GripVertical } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    useDroppable,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppSidebar } from '../components/app-sidebar';
import {
    SidebarProvider,
    SidebarInset,
    SidebarTrigger,
} from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import Logo from '../components/Logo';
import { SyncSettings } from '../components/sync';
import { useAuth } from '../components/auth/useAuth';
import '../styles/tailwind.css';

// --- Sortable components for Group Menu Personalization ---

function SortableMainMenuItem({
    token,
    isSubmenu,
    submenu,
    label,
    checked,
    onToggleVisibility,
    onRename,
    onRemove,
}: {
    token: string;
    isSubmenu: boolean;
    submenu: { id: string; label: string; visible: boolean } | null;
    label: string;
    checked: boolean;
    onToggleVisibility: (checked: boolean) => void;
    onRename?: (label: string) => void;
    onRemove?: () => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: token, data: { zone: '__main__' } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className={`flex items-center justify-between p-3 rounded-lg border border-border bg-bg-1 hover:bg-bg-2 transition-colors ${isDragging ? 'shadow-lg z-50' : ''}`}
        >
            <div className="flex items-center gap-2 flex-1">
                <button
                    ref={setActivatorNodeRef}
                    {...listeners}
                    className="touch-none p-1 rounded hover:bg-bg-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                    aria-label="Drag to reorder"
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <Switch
                    checked={checked}
                    onCheckedChange={onToggleVisibility}
                />
                {isSubmenu ? (
                    <input
                        value={submenu?.label || ''}
                        onChange={(e) => onRename?.(e.target.value)}
                        className="text-sm bg-transparent focus:outline-none flex-1"
                    />
                ) : (
                    <span className="text-sm text-gray-900 dark:text-gray-100">{label}</span>
                )}
            </div>
            <div className="flex items-center gap-2">
                {isSubmenu && (
                    <button
                        type="button"
                        onClick={onRemove}
                        className="p-1.5 rounded border border-danger/30 text-danger hover:bg-danger/10"
                        title="Remove submenu"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}

function SortableSubmenuItem({
    item,
    submenuId,
    label,
    checked,
    onToggle,
}: {
    item: string;
    submenuId: string;
    label: string;
    checked: boolean;
    onToggle: (checked: boolean) => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item, data: { submenuId } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className={`flex items-center justify-between p-3 rounded-lg border border-border bg-bg-1 hover:bg-bg-2 transition-colors ${isDragging ? 'shadow-lg z-50' : ''}`}
        >
            <div className="flex items-center gap-2 flex-1">
                <button
                    ref={setActivatorNodeRef}
                    {...listeners}
                    className="touch-none p-1 rounded hover:bg-bg-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                    aria-label="Drag to reorder"
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <Switch
                    checked={checked}
                    onCheckedChange={onToggle}
                />
                <span className="text-sm text-gray-900 dark:text-gray-100">{label}</span>
            </div>
        </div>
    );
}

function DroppableSubmenuZone({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
    const { setNodeRef, isOver } = useDroppable({ id });
    return (
        <div
            ref={setNodeRef}
            className={`p-3 border border-dashed rounded-lg bg-bg-2/40 transition-colors ${isOver ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {label || 'Submenu'} Items
                <span className="ml-2 text-gray-500 font-normal">(drag to reorder or move)</span>
            </p>
            <div className="space-y-2">
                {children}
            </div>
        </div>
    );
}

function SettingsPage() {
    const { isPro } = useAuth();
    const [settings, setSettings] = useState<Settings>(getDefaultSettings());
    const [groups, setGroups] = useState<TabGroup[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [stats, setStats] = useState({ totalGroups: 0, totalTabs: 0 });
    const [showClearModal, setShowClearModal] = useState(false);
    const [showBookmarkImport, setShowBookmarkImport] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('bluetab_sidebar_open');
        return saved !== null ? saved === 'true' : true;
    });

    // DnD sensors for @dnd-kit
    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleUnifiedDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;

        const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
        const sourceZone = (active.data.current as { zone?: string })?.zone || '';
        const targetZone = (over.data.current as { zone?: string })?.zone || (over.id as string);
        const activeId = active.id as string;
        const overId = over.id as string;

        if (activeId === overId) return;

        const submenuItemKeys: string[] = ['manageTags', 'addNote', 'lockUnlock', 'rememberThisGroup', 'copyLinks', 'shareToBluet'];

        if (sourceZone === '__main__' && targetZone === '__main__') {
            // Main → Main: reorder
            const order = [...(normalized.mainOrderV2 || [])];
            const oldIdx = order.indexOf(activeId);
            const newIdx = order.indexOf(overId);
            if (oldIdx < 0 || newIdx < 0) return;
            await saveGroupMenuConfig({ ...normalized, mainOrderV2: arrayMove(order, oldIdx, newIdx) });

        } else if (sourceZone !== '__main__' && (targetZone === '__main__' || targetZone === '__main_drop__')) {
            // Submenu → Main: promote item
            const dragItem = activeId as GroupMenuSubmenuItem;
            const mainOrder = [...(normalized.mainOrderV2 || [])];
            // Insert before the drop target in main, or at end if dropped on zone
            const insertIdx = targetZone === '__main_drop__' ? mainOrder.length : mainOrder.indexOf(overId);
            if (insertIdx < 0) mainOrder.push(dragItem);
            else mainOrder.splice(insertIdx, 0, dragItem);
            // Remove from submenu
            const srcOrder = [...(normalized.submenuItemOrder?.[sourceZone] || [])].filter(i => i !== dragItem);
            await saveGroupMenuConfig({
                ...normalized,
                mainOrderV2: mainOrder,
                submenuItemOrder: { ...(normalized.submenuItemOrder || {}), [sourceZone]: srcOrder },
            });

        } else if (sourceZone === '__main__' && targetZone !== '__main__') {
            // Main → Submenu: demote item (only submenu-type items)
            if (!submenuItemKeys.includes(activeId)) return;
            const dragItem = activeId as GroupMenuSubmenuItem;
            const mainOrder = (normalized.mainOrderV2 || []).filter(t => t !== dragItem);
            const targetOrder = [...(normalized.submenuItemOrder?.[targetZone] || [])];
            const dropIdx = targetOrder.indexOf(overId as GroupMenuSubmenuItem);
            if (dropIdx >= 0) targetOrder.splice(dropIdx, 0, dragItem);
            else targetOrder.push(dragItem);
            await saveGroupMenuConfig({
                ...normalized,
                mainOrderV2: mainOrder,
                submenuAssignments: { ...(normalized.submenuAssignments || {}), [dragItem]: targetZone },
                submenuItemOrder: { ...(normalized.submenuItemOrder || {}), [targetZone]: targetOrder },
            });

        } else if (sourceZone === targetZone) {
            // Same submenu: reorder
            const order = [...(normalized.submenuItemOrder?.[sourceZone] || [])];
            const oldIdx = order.indexOf(activeId as GroupMenuSubmenuItem);
            const newIdx = order.indexOf(overId as GroupMenuSubmenuItem);
            if (oldIdx < 0 || newIdx < 0) return;
            await saveGroupMenuConfig({
                ...normalized,
                submenuItemOrder: { ...(normalized.submenuItemOrder || {}), [sourceZone]: arrayMove(order, oldIdx, newIdx) },
            });

        } else {
            // Different submenus: move item
            await moveSubmenuItem(sourceZone, targetZone, activeId as GroupMenuSubmenuItem,
                (over.data.current as { zone?: string })?.zone ? overId as GroupMenuSubmenuItem : undefined);
        }
    };

    // Navigate to options page with project filter
    const handleSelectProject = (projectId: string | null) => {
        if (projectId) {
            window.location.href = chrome.runtime.getURL(`src/options/index.html#project=${projectId}`);
        } else {
            window.location.href = chrome.runtime.getURL('src/options/index.html');
        }
    };

    // Save sidebar state to localStorage
    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        localStorage.setItem('bluetab_sidebar_open', String(open));
    };

    useEffect(() => {
        initializeSettings();

        // Listen for storage changes to auto-update interface
        const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.groups) {
                const newGroups = changes.groups.newValue || [];
                setGroups(newGroups);
                setStats({
                    totalGroups: newGroups.length,
                    totalTabs: newGroups.reduce((sum: number, group: TabGroup) => sum + group.tabs.length, 0)
                });
            }
            if (changes.settings) {
                const newSettings = changes.settings.newValue || getDefaultSettings();
                setSettings(newSettings);
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);

        return () => {
            chrome.storage.onChanged.removeListener(handleStorageChange);
        };
    }, []);

    const initializeSettings = async () => {
        try {
            const storedSettings = await Storage.get('settings');
            const defaultSettings = getDefaultSettings();

            // Merge stored settings with defaults to ensure all fields are present
            const mergedSettings = {
                ...defaultSettings,
                ...storedSettings
            };

            const storedGroups = await Storage.get('groups') || [];

            // Initialize text size service
            try {
                await textSizeService.initialize();
            } catch (error) {
                console.error('Failed to initialize text size service:', error);
            }

            setSettings(mergedSettings);
            setGroups(storedGroups);
            setStats({
                totalGroups: storedGroups.length,
                totalTabs: storedGroups.reduce((sum: number, group: TabGroup) => sum + group.tabs.length, 0)
            });

            // Load projects
            const storedProjects = await Storage.getProjects();
            setProjects(storedProjects);

            // Save merged settings to storage if there were missing fields
            if (JSON.stringify(storedSettings) !== JSON.stringify(mergedSettings)) {
                await Storage.set('settings', mergedSettings);
            }

            ThemeManager.applyTheme(mergedSettings.theme);

            // Set dark mode state based on theme
            const currentTheme = mergedSettings.theme;
            if (currentTheme === 'dark') {
                setIsDarkMode(true);
            } else if (currentTheme === 'light') {
                setIsDarkMode(false);
            } else {
                // System theme - check system preference
                setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    };

    const exportData = async () => {
        try {
            // Get all tags from storage
            const allTags = await Storage.get<Tag[]>('tags') || [];

            // Get pin settings
            const pinSettings = await Storage.getPinSettings();

            // Get all archives
            let archives = {};
            try {
                const { ArchiveStorageService } = await import('../utils/archive-storage');
                const archiveData = await ArchiveStorageService.getArchives();
                archives = archiveData.archives || {};
            } catch (archiveError) {
                console.warn('Could not export archives:', archiveError);
            }

            // Get textSize settings from sync storage
            let textSettings = null;
            try {
                const syncResult = await chrome.storage.sync.get('bluetab_text_size_settings');
                textSettings = syncResult.bluetab_text_size_settings || null;
            } catch (textError) {
                console.warn('Could not export text settings:', textError);
            }

            // Get layoutMode from local storage
            const layoutMode = await Storage.get<string>('layoutMode') || 'grid';

            // Get collapsed groups state (object format: {groupId: boolean})
            const collapsedGroups = await Storage.get<Record<string, boolean>>('collapsedGroups') || {};

            // Get Flow settings if user is Pro and has rules
            let flowSettings: FlowSettings | null = null;
            try {
                const { canAccessFeature } = await import('../utils/feature-gate');
                const { FlowStorageService } = await import('../utils/flow-storage');

                const accessResult = await canAccessFeature('flow');
                if (accessResult.allowed) {
                    const storedFlowSettings = await FlowStorageService.getFlowSettings();
                    // Only include if there are rules
                    if (storedFlowSettings.rules && storedFlowSettings.rules.length > 0) {
                        flowSettings = storedFlowSettings;
                        console.log(`[BlueTab][Export] Including ${storedFlowSettings.rules.length} Flow rules`);
                    }
                }
            } catch (flowError) {
                console.warn('Could not export Flow settings:', flowError);
            }

            // Get group memory data
            let groupMemory = null;
            try {
                const { GroupMemoryStorageService } = await import('../utils/group-memory-storage');
                const memoryData = await GroupMemoryStorageService.getMemory();
                // Only include if there are remembered groups
                if (Object.keys(memoryData.groups).length > 0) {
                    groupMemory = memoryData;
                    console.log(`[BlueTab][Export] Including ${Object.keys(memoryData.groups).length} remembered groups`);
                }
            } catch (memoryError) {
                console.warn('Could not export group memory:', memoryError);
            }

            // Get projects
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
            a.download = `bluetab-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            ToastManager.getInstance().success('Complete backup exported');
        } catch (error) {
            console.error('Failed to export data:', error);
            ToastManager.getInstance().error('Failed to export: ' + (error as Error).message);
        }
    };

    const exportAsHTML = async () => {
        try {
            const exportDate = new Date().toISOString();
            const totalTabs = groups.reduce((sum, group) => sum + group.tabs.length, 0);
            const currentTheme = settings.theme === 'dark' ? 'dark' : (settings.theme === 'light' ? 'light' : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

            const html = `<!DOCTYPE html>
<html lang="en" class="${currentTheme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BlueTab Export - ${new Date().toLocaleDateString()}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        /* ============================================
           CSS Variables - BlueTab Design Tokens
           ============================================ */
        :root {
            --bg-0: hsl(220 15% 97%);
            --bg-1: hsl(220 15% 99%);
            --bg-2: hsl(0 0% 100%);
            --text-strong: hsl(220 15% 10%);
            --text: hsl(220 10% 35%);
            --text-muted: hsl(220 8% 55%);
            --border: hsl(220 12% 88%);
            --border-subtle: hsl(220 12% 92%);
            --primary: hsl(215 90% 55%);
            --primary-hover: hsl(215 90% 60%);
            --gradient-start: hsl(215 90% 55%);
            --gradient-end: hsl(250 80% 60%);
            --card-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
            --card-shadow-hover: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);
        }

        html.dark {
            --bg-0: hsl(220 15% 6%);
            --bg-1: hsl(220 14% 10%);
            --bg-2: hsl(220 13% 14%);
            --text-strong: hsl(220 10% 94%);
            --text: hsl(220 10% 75%);
            --text-muted: hsl(220 10% 55%);
            --border: hsl(220 12% 20%);
            --border-subtle: hsl(220 12% 16%);
            --card-shadow: 0 4px 6px -1px rgba(0,0,0,0.4), 0 2px 4px -2px rgba(0,0,0,0.3);
            --card-shadow-hover: 0 20px 25px -5px rgba(0,0,0,0.4), 0 8px 10px -6px rgba(0,0,0,0.3);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: var(--text);
            background: var(--bg-0);
            min-height: 100vh;
            transition: background-color 0.3s ease, color 0.3s ease;
        }

        /* ============================================
           Header - Theme Aware
           ============================================ */
        .header {
            background: var(--bg-1);
            border-bottom: 1px solid var(--border);
            color: var(--text-strong);
            padding: 3rem 2rem;
        }

        .header-content {
            max-width: 1200px;
            margin: 0 auto;
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1.5rem;
        }

        .logo-icon {
            width: 48px;
            height: 48px;
        }

        .logo-icon svg {
            width: 100%;
            height: 100%;
        }

        .logo-text {
            font-size: 1.75rem;
            font-weight: 700;
            letter-spacing: -0.02em;
            color: var(--text-strong);
        }

        .header h1 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            letter-spacing: -0.02em;
        }

        .header .subtitle {
            font-size: 1rem;
            opacity: 0.9;
        }

        /* Stats Cards */
        .stats {
            display: flex;
            gap: 1rem;
            margin-top: 2rem;
        }

        .stat-card {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 1.25rem 1.5rem;
            min-width: 140px;
        }

        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            line-height: 1;
            margin-bottom: 0.25rem;
            color: var(--primary);
        }

        .stat-label {
            font-size: 0.875rem;
            color: var(--text-muted);
            font-weight: 500;
        }

        /* ============================================
           Content Area
           ============================================ */
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }

        .section-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-strong);
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        /* ============================================
           Group Cards - Modern Design
           ============================================ */
        .groups-grid {
            display: grid;
            gap: 1.5rem;
        }

        .group-card {
            background: var(--bg-1);
            border: 1px solid var(--border);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: var(--card-shadow);
            transition: all 0.3s ease;
        }

        .group-card:hover {
            box-shadow: var(--card-shadow-hover);
            transform: translateY(-2px);
        }

        .group-header {
            padding: 1.25rem 1.5rem;
            border-bottom: 1px solid var(--border-subtle);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .group-info {
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .group-icon {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1rem;
        }

        .group-title {
            font-size: 1.125rem;
            font-weight: 600;
            color: var(--text-strong);
        }

        .group-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.8125rem;
            color: var(--text-muted);
        }

        .group-meta span {
            display: flex;
            align-items: center;
            gap: 0.25rem;
        }

        .group-badge {
            background: var(--primary);
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 50px;
            font-size: 0.75rem;
            font-weight: 600;
        }

        /* ============================================
           Tab Items
           ============================================ */
        .tabs-list {
            list-style: none;
        }

        .tab-item {
            padding: 1rem 1.5rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            border-bottom: 1px solid var(--border-subtle);
            transition: background-color 0.2s ease;
        }

        .tab-item:last-child {
            border-bottom: none;
        }

        .tab-item:hover {
            background: var(--bg-2);
        }

        .tab-favicon {
            width: 24px;
            height: 24px;
            border-radius: 6px;
            flex-shrink: 0;
            background: var(--bg-2);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
        }

        .tab-info {
            flex: 1;
            min-width: 0;
        }

        .tab-title {
            font-weight: 500;
            color: var(--text-strong);
            margin-bottom: 0.125rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .tab-url {
            font-size: 0.8125rem;
            color: var(--text-muted);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .tab-url a {
            color: var(--primary);
            text-decoration: none;
            transition: color 0.2s ease;
        }

        .tab-url a:hover {
            color: var(--primary-hover);
            text-decoration: underline;
        }

        .empty-group {
            padding: 3rem 2rem;
            text-align: center;
            color: var(--text-muted);
        }

        /* ============================================
           Footer
           ============================================ */
        .footer {
            text-align: center;
            padding: 3rem 2rem;
            color: var(--text-muted);
            font-size: 0.875rem;
            border-top: 1px solid var(--border-subtle);
            margin-top: 2rem;
        }

        .footer-brand {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin-bottom: 0.5rem;
            color: var(--text);
            font-weight: 500;
        }

        /* ============================================
           Responsive Design
           ============================================ */
        @media (max-width: 768px) {
            .header {
                padding: 2rem 1rem;
            }

            .logo-row {
                flex-direction: column;
                gap: 1rem;
            }

            .header h1 {
                font-size: 1.5rem;
            }

            .stats {
                flex-direction: column;
            }

            .stat-card {
                min-width: 100%;
            }

            .container {
                padding: 1rem;
            }

            .group-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 1rem;
            }

            .tab-item {
                padding: 0.875rem 1rem;
            }
        }

        /* ============================================
           Print Styles
           ============================================ */
        @media print {
            .group-card {
                break-inside: avoid;
                box-shadow: none;
            }

            .group-card:hover {
                transform: none;
            }
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="header-content">
            <div class="logo">
                <div class="logo-icon">
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="4" width="40" height="40" rx="10" fill="#234FD7"/>
                        <rect x="8" y="8" width="32" height="32" rx="8" stroke="white" stroke-width="2"/>
                        <rect x="12" y="12" width="24" height="24" rx="6" fill="#234FD7" stroke="white" stroke-width="2"/>
                        <path d="M24 18C22.5 18 21.2 18.8 20.5 20C19.8 18.8 18.5 18 17 18C14.8 18 13 19.8 13 22C13 26 20 30 24 32C28 30 35 26 35 22C35 19.8 33.2 18 31 18C29.5 18 28.2 18.8 27.5 20C26.8 18.8 25.5 18 24 18Z" fill="white"/>
                    </svg>
                </div>
                <span class="logo-text">Bluetab</span>
            </div>
            <h1>Tab Groups Backup</h1>
            <p class="subtitle">${new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}</p>
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-value">${groups.length}</div>
                    <div class="stat-label">Groups</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${totalTabs}</div>
                    <div class="stat-label">Total Tabs</div>
                </div>
            </div>
        </div>
    </header>

    <main class="container">
        <h2 class="section-title">📁 Your Groups</h2>
        <div class="groups-grid">
            ${groups.map((group, index) => `
                <article class="group-card">
                    <div class="group-header">
                        <div class="group-info">
                            <div class="group-icon">📑</div>
                            <div>
                                <h3 class="group-title">${escapeHtml(group.name)}</h3>
                                <div class="group-meta">
                                    <span>📅 ${new Date(group.created).toLocaleDateString()}</span>
                                    <span>🔄 ${new Date(group.modified).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                        <span class="group-badge">${group.tabs.length} tab${group.tabs.length !== 1 ? 's' : ''}</span>
                    </div>
                    ${group.tabs.length > 0 ? `
                        <ul class="tabs-list">
                            ${group.tabs.map(tab => `
                                <li class="tab-item">
                                    ${tab.favicon
                    ? `<img src="${escapeHtml(tab.favicon)}" alt="" class="tab-favicon" onerror="this.innerHTML='🔗'; this.style.fontSize='1rem'">`
                    : '<div class="tab-favicon">🔗</div>'
                }
                                    <div class="tab-info">
                                        <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
                                        <div class="tab-url"><a href="${escapeHtml(tab.url)}" target="_blank" rel="noopener">${escapeHtml(tab.url)}</a></div>
                                    </div>
                                </li>
                            `).join('')}
                        </ul>
                    ` : `
                        <div class="empty-group">No tabs in this group</div>
                    `}
                </article>
            `).join('')}
        </div>
    </main>

    <footer class="footer">
        <div class="footer-brand">
            <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="4" width="40" height="40" rx="10" fill="#234FD7"/>
                <rect x="12" y="12" width="24" height="24" rx="6" stroke="white" stroke-width="2"/>
            </svg>
            <span>Exported from Bluetab</span>
        </div>
        <p>${new Date(exportDate).toLocaleString()}</p>
    </footer>
</body>
</html>`;

            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bluetab-export-${new Date().toISOString().split('T')[0]}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            ToastManager.getInstance().success('HTML export completed successfully');
        } catch (error) {
            console.error('Failed to export as HTML:', error);
            ToastManager.getInstance().error('Failed to export HTML: ' + (error as Error).message);
        }
    };

    // Helper function to escape HTML special characters
    const escapeHtml = (text: string): string => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    const importData = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);

                if (!data.groups || !Array.isArray(data.groups)) {
                    ToastManager.getInstance().error('Invalid backup file: missing groups data');
                    return;
                }

                console.log('Starting comprehensive import...');

                // Create group ID mapping (old -> new)
                const originalToNewIdMap = new Map<string, string>();

                // ===== TAG IMPORT WITH SMART MAPPING =====
                const tagIdMapping = new Map<string, string>();

                if (data.tags && Array.isArray(data.tags)) {
                    console.log('Importing tags from backup:', data.tags.length);

                    const currentTags = await Storage.get<Tag[]>('tags') || [];
                    const existingTagNames = new Map(currentTags.map(t => [t.name.toLowerCase(), t.id]));
                    const newTags: Tag[] = [];

                    for (const importedTag of data.tags) {
                        const existingByName = existingTagNames.get(importedTag.name.toLowerCase());

                        if (existingByName) {
                            tagIdMapping.set(importedTag.id, existingByName);
                            console.log(`Tag "${importedTag.name}" exists, mapping to ${existingByName}`);
                        } else {
                            const newId = crypto.randomUUID();
                            tagIdMapping.set(importedTag.id, newId);
                            newTags.push({
                                ...importedTag,
                                id: newId,
                                created: Date.now()
                            });
                            console.log(`Creating new tag: "${importedTag.name}" with id ${newId}`);
                        }
                    }

                    if (newTags.length > 0) {
                        const mergedTags = [...currentTags, ...newTags];
                        await Storage.set('tags', mergedTags);
                        setTags(mergedTags);
                        console.log(`Created ${newTags.length} new tags, total: ${mergedTags.length}`);
                    }
                }

                // ===== IMPORT PROJECTS FIRST (before groups) =====
                let importedProjectIds = new Set<string>();
                let projectsCount = 0;
                if (data.projects && Array.isArray(data.projects) && data.projects.length > 0) {
                    console.log('Importing projects from backup:', data.projects.length);
                    try {
                        const currentProjects = await Storage.getProjects();
                        const existingIds = new Set(currentProjects.map(p => p.id));

                        // Track all valid project IDs (existing + new)
                        importedProjectIds = new Set([...existingIds]);

                        // Filter out projects that already exist and add new ones
                        const newProjects = data.projects.filter((p: any) => !existingIds.has(p.id));

                        if (newProjects.length > 0) {
                            const mergedProjects = [...currentProjects, ...newProjects];
                            await Storage.set('projects', mergedProjects);
                            projectsCount = newProjects.length;

                            // Add new project IDs to valid set
                            newProjects.forEach((p: any) => importedProjectIds.add(p.id));
                            console.log(`Successfully imported ${projectsCount} projects`);
                        }
                    } catch (projectError) {
                        console.error('Failed to import projects:', projectError);
                    }
                } else {
                    // No projects in backup, get current projects for validation
                    const currentProjects = await Storage.getProjects();
                    importedProjectIds = new Set(currentProjects.map(p => p.id));
                }

                // ===== IMPORT GROUPS WITH TAG AND PROJECT MAPPING =====
                const safeGroups = data.groups.map((group: TabGroup) => {
                    const newGroupId = crypto.randomUUID();
                    originalToNewIdMap.set(group.id, newGroupId);

                    const mappedTags = (group.tags || []).map((oldTagId: string) => {
                        return tagIdMapping.get(oldTagId) || oldTagId;
                    });

                    // Validate projectId - only keep if project exists
                    const validProjectId = group.projectId && importedProjectIds.has(group.projectId)
                        ? group.projectId
                        : undefined;

                    if (group.projectId && !validProjectId) {
                        console.log(`Group "${group.name}" had invalid projectId ${group.projectId}, removing`);
                    }

                    return {
                        ...group,
                        id: newGroupId,
                        tags: mappedTags,
                        projectId: validProjectId,
                        tabs: group.tabs.map(tab => ({
                            ...tab,
                            id: crypto.randomUUID()
                        })),
                        modified: Date.now()
                    };
                });

                const currentGroups = await Storage.get('groups') as TabGroup[] || [];
                const importedGroups = [...currentGroups, ...safeGroups];
                await Storage.set('groups', importedGroups);
                setGroups(importedGroups);

                // ===== IMPORT SETTINGS =====
                if (data.settings && typeof data.settings === 'object') {
                    const { autoBackup, backupInterval, ...cleanSettings } = data.settings;
                    const newSettings = { ...cleanSettings };

                    console.log('Applying imported settings:', newSettings);

                    await Storage.set('settings', newSettings);
                    setSettings(newSettings);

                    // Apply theme immediately
                    if (newSettings.theme) {
                        ThemeManager.applyTheme(newSettings.theme);
                        setIsDarkMode(newSettings.theme === 'dark');
                    }
                }

                // ===== IMPORT TEXT SETTINGS =====
                if (data.textSettings) {
                    try {
                        await chrome.storage.sync.set({ bluetab_text_size_settings: data.textSettings });
                        console.log('Imported text settings:', data.textSettings);

                        // Apply text size immediately
                        if (data.textSettings.textSize) {
                            await textSizeService.applyTextSize(data.textSettings.textSize);
                        }
                    } catch (textError) {
                        console.error('Failed to import text settings:', textError);
                    }
                }

                // ===== IMPORT LAYOUT MODE =====
                if (data.layoutMode) {
                    try {
                        await Storage.set('layoutMode', data.layoutMode);
                        console.log('Imported layout mode:', data.layoutMode);
                    } catch (layoutError) {
                        console.error('Failed to import layout mode:', layoutError);
                    }
                }

                // ===== IMPORT COLLAPSED GROUPS =====
                if (data.collapsedGroups && typeof data.collapsedGroups === 'object' && !Array.isArray(data.collapsedGroups)) {
                    try {
                        // Map old group IDs to new IDs (object format: {groupId: boolean})
                        const mappedCollapsedGroups: Record<string, boolean> = {};

                        for (const [oldGroupId, isCollapsed] of Object.entries(data.collapsedGroups)) {
                            const newGroupId = originalToNewIdMap.get(oldGroupId);
                            if (newGroupId) {
                                mappedCollapsedGroups[newGroupId] = isCollapsed as boolean;
                            }
                        }

                        await Storage.set('collapsedGroups', mappedCollapsedGroups);
                        console.log(`Imported ${Object.keys(mappedCollapsedGroups).length} collapsed groups`);
                    } catch (collapseError) {
                        console.error('Failed to import collapsed groups:', collapseError);
                    }
                }

                // ===== IMPORT PIN SETTINGS =====
                if (data.pinSettings?.pinnedGroups) {
                    try {
                        const existingPinSettings = await Storage.getPinSettings();
                        const newPinSettings = { ...existingPinSettings };

                        for (const [oldGroupId, pinData] of Object.entries(data.pinSettings.pinnedGroups)) {
                            const newGroupId = originalToNewIdMap.get(oldGroupId);
                            if (newGroupId && pinData) {
                                newPinSettings.pinnedGroups[newGroupId] = pinData as { isPinned: boolean; pinnedAt: number };
                            }
                        }

                        await Storage.set('pinSettings', newPinSettings);
                        console.log(`Imported pin settings for ${Object.keys(data.pinSettings.pinnedGroups).length} groups`);
                    } catch (pinError) {
                        console.error('Failed to import pin settings:', pinError);
                    }
                }

                // ===== IMPORT ARCHIVES =====
                let archiveCount = 0;
                if (data.archives && typeof data.archives === 'object') {
                    console.log('Importing archives from backup:', Object.keys(data.archives).length);
                    try {
                        const { ArchiveStorageService } = await import('../utils/archive-storage');

                        for (const [originalId, archive] of Object.entries(data.archives)) {
                            try {
                                const archiveData = archive as any;
                                const newId = crypto.randomUUID();

                                const newArchive = {
                                    ...archiveData,
                                    id: newId,
                                    // Remove old checksum - will be recalculated by storeArchive
                                    checksum: undefined
                                };

                                // CRITICAL: For unencrypted archives, update inner group ID and tags
                                if (!newArchive.protection?.passwordProtected &&
                                    newArchive.originalGroup &&
                                    typeof newArchive.originalGroup === 'object') {
                                    newArchive.originalGroup = {
                                        ...newArchive.originalGroup,
                                        id: newId,
                                        // Map old tag IDs to new tag IDs
                                        tags: newArchive.originalGroup.tags?.map((oldTagId: string) =>
                                            tagIdMapping.get(oldTagId) || oldTagId
                                        ) || []
                                    };
                                }

                                console.log(`Importing archive: ${originalId} -> ${newArchive.id}`);
                                await ArchiveStorageService.storeArchive(newArchive);
                                archiveCount++;
                            } catch (singleArchiveError) {
                                console.error(`Failed to import archive ${originalId}:`, singleArchiveError);
                            }
                        }

                        if (archiveCount > 0) {
                            console.log(`Successfully imported ${archiveCount} archives`);
                        }
                    } catch (archiveError) {
                        console.error('Failed to import archives:', archiveError);
                    }
                }

                // ===== IMPORT FLOW SETTINGS (Pro only) =====
                let flowRulesCount = 0;
                if (data.flowSettings && data.flowSettings.rules && data.flowSettings.rules.length > 0) {
                    console.log('Found Flow settings in backup:', data.flowSettings.rules.length, 'rules');

                    try {
                        const { canAccessFeature } = await import('../utils/feature-gate');
                        const { FlowStorageService } = await import('../utils/flow-storage');

                        const accessResult = await canAccessFeature('flow');
                        if (accessResult.allowed) {
                            // Get current Flow settings
                            const currentFlowSettings = await FlowStorageService.getFlowSettings();
                            const now = Date.now();

                            // Generate new IDs for imported rules to avoid conflicts
                            const importedRules = data.flowSettings.rules.map((rule: any, index: number) => ({
                                ...rule,
                                id: crypto.randomUUID(),
                                created: now,
                                modified: now,
                                priority: currentFlowSettings.rules.length + index,
                                triggerCount: 0,
                                // Map tag IDs if present
                                action: rule.action ? {
                                    ...rule.action,
                                    tags: rule.action.tags?.map((oldTagId: string) =>
                                        tagIdMapping.get(oldTagId) || oldTagId
                                    )
                                } : rule.action
                            }));

                            // Merge with existing rules
                            const mergedFlowSettings = {
                                ...currentFlowSettings,
                                rules: [...currentFlowSettings.rules, ...importedRules],
                                enabled: data.flowSettings.enabled ?? currentFlowSettings.enabled
                            };

                            await FlowStorageService.setFlowSettings(mergedFlowSettings);
                            flowRulesCount = importedRules.length;
                            console.log(`Successfully imported ${flowRulesCount} Flow rules`);
                        } else {
                            console.log('Flow import skipped: user is not Pro');
                        }
                    } catch (flowError) {
                        console.error('Failed to import Flow settings:', flowError);
                    }
                }

                // ===== IMPORT GROUP MEMORY =====
                let groupMemoryCount = 0;
                if (data.groupMemory && data.groupMemory.groups && typeof data.groupMemory.groups === 'object') {
                    console.log('Importing group memory from backup:', Object.keys(data.groupMemory.groups).length, 'remembered groups');

                    try {
                        const { GroupMemoryStorageService } = await import('../utils/group-memory-storage');

                        // Get current memory
                        const currentMemory = await GroupMemoryStorageService.getMemory();

                        // Import each remembered group with mapped IDs
                        for (const [oldGroupId, rememberedGroup] of Object.entries(data.groupMemory.groups)) {
                            const group = rememberedGroup as any;
                            const newGroupId = crypto.randomUUID();

                            // Map tag IDs in remembered group
                            const mappedTags = (group.tags || []).map((oldTagId: string) =>
                                tagIdMapping.get(oldTagId) || oldTagId
                            );

                            // Create new remembered group with mapped IDs
                            currentMemory.groups[newGroupId] = {
                                ...group,
                                id: newGroupId,
                                tags: mappedTags,
                                rememberedAt: Date.now()
                            };

                            // Update URL index for this group's tabs
                            if (group.tabs && Array.isArray(group.tabs)) {
                                for (const tab of group.tabs) {
                                    if (tab.url) {
                                        currentMemory.urlIndex[tab.url] = newGroupId;
                                    }
                                }
                            }

                            groupMemoryCount++;
                        }

                        // Save merged memory
                        await Storage.set('groupMemory', currentMemory);
                        console.log(`Successfully imported ${groupMemoryCount} remembered groups`);
                    } catch (memoryError) {
                        console.error('Failed to import group memory:', memoryError);
                    }
                }

                // Update stats
                setStats({
                    totalGroups: importedGroups.length,
                    totalTabs: importedGroups.reduce((sum: number, group: TabGroup) => sum + group.tabs.length, 0)
                });

                // Success message
                let successMsg = `Imported ${data.groups.length} groups`;
                if (archiveCount > 0) successMsg += `, ${archiveCount} archives`;
                if (flowRulesCount > 0) successMsg += `, ${flowRulesCount} Flow rules`;
                if (groupMemoryCount > 0) successMsg += `, ${groupMemoryCount} remembered groups`;
                if (projectsCount > 0) successMsg += `, ${projectsCount} projects`;
                ToastManager.getInstance().success(successMsg + ' successfully!');

            } catch (error) {
                console.error('Import failed:', error);
                ToastManager.getInstance().error('Invalid backup file format!');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    const clearAllData = () => {
        setShowClearModal(true);
    };

    const handleClearConfirm = async () => {
        try {
            // Clear groups
            await Storage.set('groups', []);
            setGroups([]);

            // Clear tags
            await Storage.set('tags', []);
            setTags([]);

            // Clear archives
            try {
                const { ArchiveStorageService } = await import('../utils/archive-storage');
                await ArchiveStorageService.clearAllArchives();
            } catch (archiveError) {
                console.warn('Could not clear archives:', archiveError);
            }

            // Clear Flow settings
            try {
                const { FlowStorageService } = await import('../utils/flow-storage');
                await FlowStorageService.clearAll();
                console.log('[BlueTab][Settings] Flow data cleared');
            } catch (flowError) {
                console.warn('Could not clear Flow settings:', flowError);
            }

            // Clear pin settings
            await Storage.set('pinSettings', { pinnedGroups: {} });

            setStats({ totalGroups: 0, totalTabs: 0 });
            ToastManager.getInstance().success('All data cleared successfully!');
        } catch (error) {
            ToastManager.getInstance().error('Failed to clear data: ' + (error as Error).message);
        }
        setShowClearModal(false);
    };

    const handleThemeToggle = async (checked: boolean) => {
        try {
            const newTheme: Theme = checked ? 'dark' : 'light';
            const updatedSettings = { ...settings, theme: newTheme };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
            setIsDarkMode(checked);
            ThemeManager.applyTheme(newTheme);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save theme preference: ' + (error as Error).message);
        }
    };

    const updateSortOrder = async (newSortOrder: SortOrder) => {
        try {
            const updatedSettings = { ...settings, sortOrder: newSortOrder };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save sort preference: ' + (error as Error).message);
        }
    };

    const updateMaxGroups = async (maxGroups: number) => {
        try {
            const updatedSettings = { ...settings, maxGroups };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save max groups setting: ' + (error as Error).message);
        }
    };

    const updateRestoreMode = async (mode: 'smart' | 'newWindow' | 'currentWindow') => {
        try {
            const updatedSettings = { ...settings, restoreMode: mode };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save restore mode: ' + (error as Error).message);
        }
    };

    const updateTabUrlDisplay = async (mode: 'full' | 'hostname') => {
        try {
            const updatedSettings = { ...settings, tabUrlDisplay: mode };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save tab URL display: ' + (error as Error).message);
        }
    };

    const updateGroupNotesDisplay = async (mode: 'full' | 'preview') => {
        try {
            const updatedSettings = { ...settings, groupNotesDisplay: mode };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save group notes display: ' + (error as Error).message);
        }
    };

    const updateTabGroupRestoreMode = async (mode: 'normal' | 'browserGroups') => {
        try {
            const updatedSettings = { ...settings, tabGroupRestoreMode: mode };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
            ToastManager.getInstance().success('Tab group restore mode updated');
        } catch (error) {
            ToastManager.getInstance().error('Failed to save tab group restore mode: ' + (error as Error).message);
        }
    };

    const updatePinnedTabsMode = async (mode: 'exclude' | 'include') => {
        try {
            const updatedSettings = { ...settings, pinnedTabsMode: mode };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save pinned tabs mode: ' + (error as Error).message);
        }
    };

    const updateStartupBehavior = async (behavior: 'show' | 'manual') => {
        try {
            const updatedSettings = { ...settings, startupBehavior: behavior };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save startup behavior: ' + (error as Error).message);
        }
    };

    const updateRestoreBehavior = async (behavior: 'removeFromList' | 'keepInList') => {
        try {
            const updatedSettings = { ...settings, restoreBehavior: behavior };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save restore behavior: ' + (error as Error).message);
        }
    };

    const updateDuplicateHandling = async (handling: 'allow' | 'reject') => {
        try {
            const updatedSettings = { ...settings, duplicateHandling: handling };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save duplicate handling: ' + (error as Error).message);
        }
    };

    const updateCustomNewTabEnabled = async (enabled: boolean) => {
        try {
            const updatedSettings = { ...settings, customNewTabEnabled: enabled };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
            ToastManager.getInstance().success(enabled ? 'Custom New Tab page enabled' : 'Custom New Tab page disabled');
        } catch (error) {
            ToastManager.getInstance().error('Failed to save custom new tab setting: ' + (error as Error).message);
        }
    };

    const updateContextMenuGroupLimit = async (limit: number) => {
        try {
            const updatedSettings = { ...settings, contextMenuGroupLimit: limit };
            await Storage.set('settings', updatedSettings);
            setSettings(updatedSettings);
            ToastManager.getInstance().success(`Context menu will show up to ${limit} groups`);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save context menu setting: ' + (error as Error).message);
        }
    };

    const saveGroupMenuConfig = async (nextConfig: ReturnType<typeof getNormalizedGroupMenuConfig>) => {
        const updatedSettings = { ...settings, groupMenuConfig: nextConfig };
        await Storage.set('settings', updatedSettings);
        setSettings(updatedSettings);
    };

    const updateGroupMenuItem = async (key: string, checked: boolean) => {
        try {
            const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
            const nextConfig = {
                ...normalized,
                [key]: checked,
            };
            await saveGroupMenuConfig(nextConfig);
        } catch (error) {
            ToastManager.getInstance().error('Failed to save group menu setting: ' + (error as Error).message);
        }
    };



    const moveSubmenuItem = async (
        sourceSubmenuId: string,
        targetSubmenuId: string,
        dragItem: GroupMenuSubmenuItem,
        dropItem?: GroupMenuSubmenuItem
    ) => {
        const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
        const nextAssignments = {
            ...(normalized.submenuAssignments || {}),
            [dragItem]: targetSubmenuId,
        };

        const nextOrder = { ...(normalized.submenuItemOrder || {}) };
        const sourceOrder = [...(nextOrder[sourceSubmenuId] || [])].filter((entry) => entry !== dragItem);
        let targetOrder = [...(nextOrder[targetSubmenuId] || [])].filter((entry) => entry !== dragItem);

        if (dropItem && targetOrder.includes(dropItem)) {
            const targetIndex = targetOrder.indexOf(dropItem);
            targetOrder.splice(targetIndex, 0, dragItem);
        } else {
            targetOrder.push(dragItem);
        }

        await saveGroupMenuConfig({
            ...normalized,
            submenuAssignments: nextAssignments,
            submenuItemOrder: {
                ...nextOrder,
                [sourceSubmenuId]: sourceOrder,
                [targetSubmenuId]: targetOrder,
            },
        });
    };

    const addSubmenu = async () => {
        try {
            const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
            const newId = `submenu_${Date.now()}`;
            const submenus = [...(normalized.submenus || []), { id: newId, label: 'New Submenu', visible: true }];
            const mainOrderV2 = [...(normalized.mainOrderV2 || []), `submenu:${newId}`];

            await saveGroupMenuConfig({
                ...normalized,
                submenus,
                mainOrderV2,
                submenuItemOrder: {
                    ...(normalized.submenuItemOrder || {}),
                    [newId]: [],
                },
            });
        } catch (error) {
            ToastManager.getInstance().error('Failed to add submenu: ' + (error as Error).message);
        }
    };

    const renameSubmenu = async (submenuId: string, label: string) => {
        const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
        const submenus = (normalized.submenus || []).map((submenu) =>
            submenu.id === submenuId ? { ...submenu, label } : submenu
        );
        await saveGroupMenuConfig({ ...normalized, submenus });
    };

    const toggleSubmenuVisibility = async (submenuId: string, visible: boolean) => {
        const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
        const submenus = (normalized.submenus || []).map((submenu) =>
            submenu.id === submenuId ? { ...submenu, visible } : submenu
        );
        await saveGroupMenuConfig({ ...normalized, submenus });
    };

    const removeSubmenu = async (submenuId: string) => {
        try {
            const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
            const remainingSubmenus = (normalized.submenus || []).filter((submenu) => submenu.id !== submenuId);
            if (remainingSubmenus.length === 0) {
                ToastManager.getInstance().error('At least one submenu is required');
                return;
            }

            const fallbackId = remainingSubmenus[0].id;
            const reassigned = { ...(normalized.submenuAssignments || {}) };
            (Object.keys(reassigned) as GroupMenuSubmenuItem[]).forEach((key) => {
                if (reassigned[key] === submenuId) {
                    reassigned[key] = fallbackId;
                }
            });

            const nextItemOrder = { ...(normalized.submenuItemOrder || {}) };
            delete nextItemOrder[submenuId];
            const movedItems = (normalized.submenuItemOrder?.[submenuId] || []);
            nextItemOrder[fallbackId] = [
                ...(nextItemOrder[fallbackId] || []),
                ...movedItems.filter((item) => !((nextItemOrder[fallbackId] || []).includes(item))),
            ];

            await saveGroupMenuConfig({
                ...normalized,
                submenus: remainingSubmenus,
                submenuAssignments: reassigned,
                submenuItemOrder: nextItemOrder,
                mainOrderV2: (normalized.mainOrderV2 || []).filter((token) => token !== `submenu:${submenuId}`),
            });
        } catch (error) {
            ToastManager.getInstance().error('Failed to remove submenu: ' + (error as Error).message);
        }
    };

    const assignItemToSubmenu = async (item: GroupMenuSubmenuItem, submenuId: string) => {
        const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
        const previousSubmenu = normalized.submenuAssignments?.[item];
        const nextAssignments = {
            ...(normalized.submenuAssignments || {}),
            [item]: submenuId,
        };

        const nextOrder = { ...(normalized.submenuItemOrder || {}) };
        if (previousSubmenu && nextOrder[previousSubmenu]) {
            nextOrder[previousSubmenu] = nextOrder[previousSubmenu].filter((entry) => entry !== item);
        }
        nextOrder[submenuId] = [...(nextOrder[submenuId] || []), item].filter(
            (entry, index, array) => array.indexOf(entry) === index
        );

        await saveGroupMenuConfig({
            ...normalized,
            submenuAssignments: nextAssignments,
            submenuItemOrder: nextOrder,
        });
    };

    const resetGroupMenuConfig = async () => {
        try {
            await saveGroupMenuConfig(getDefaultGroupMenuConfig());
            ToastManager.getInstance().success('Group menu settings reset to default');
        } catch (error) {
            ToastManager.getInstance().error('Failed to reset group menu settings: ' + (error as Error).message);
        }
    };

    const goBack = () => {
        window.location.href = chrome.runtime.getURL('src/options/index.html');
    };

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                activePage="settings"
                projects={projects}
                onSelectProject={handleSelectProject}
            />
            <SidebarInset>
                <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center gap-2 border-b border-border px-4 bg-bg-1">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="mr-2 h-4" />
                    <div>
                        <h1 className="text-lg font-semibold text-text-strong">Settings</h1>
                        <p className="text-xs text-text-muted">Manage your BlueTab preferences</p>
                    </div>
                </header>
                <div className="flex flex-1 flex-col gap-4 p-4 bg-bg-0">
                    <div className="max-w-4xl mx-auto w-full">
                        <div className="bg-bg-1 rounded-lg shadow-sm border border-border">
                            <div className="p-4 sm:p-6">
                                <div className="space-y-8">
                                    {/* Appearance Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-palette"></i>
                                            Appearance
                                        </h3>

                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                                                    <label className="text-base font-medium text-gray-900 dark:text-gray-100">
                                                        Theme
                                                    </label>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">
                                                        {isDarkMode ? 'Dark' : 'Light'}
                                                    </span>
                                                    <Switch
                                                        checked={isDarkMode}
                                                        onCheckedChange={handleThemeToggle}
                                                    />
                                                    <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Text Size Settings */}
                                    <div>
                                        <TextSizeSetting
                                            className="space-y-4"
                                            showLabels={true}
                                        />
                                    </div>

                                    {/* Cloud Sync Settings */}
                                    <div className="pt-4 border-t border-border">
                                        <SyncSettings />
                                    </div>

                                    {/* Tab Restore Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-window-restore"></i>
                                            Tab Restoration
                                        </h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                    When restoring a tab group, open tabs in:
                                                </label>
                                                <RadioGroup
                                                    value={settings.restoreMode}
                                                    onValueChange={(value) => updateRestoreMode(value as 'smart' | 'newWindow' | 'currentWindow')}
                                                    className="space-y-3"
                                                >
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="smart" id="restore-smart" className="mt-1" />
                                                        <Label htmlFor="restore-smart" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                New window if BlueTab is not the only tab in current window
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Smart mode: Uses current window only if BlueTab is the only tab open
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="newWindow" id="restore-new" className="mt-1" />
                                                        <Label htmlFor="restore-new" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Always open in new window
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Always creates a new window for restored tabs
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="currentWindow" id="restore-current" className="mt-1" />
                                                        <Label htmlFor="restore-current" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Always open in current window
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Adds tabs to the current window
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tab Group Restore Mode */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-layer-group"></i>
                                            Tab Group Restore Mode
                                        </h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                    When restoring a tab group, organize tabs as:
                                                </label>
                                                <RadioGroup
                                                    value={settings.tabGroupRestoreMode || 'normal'}
                                                    onValueChange={(value) => updateTabGroupRestoreMode(value as 'normal' | 'browserGroups')}
                                                    className="space-y-3"
                                                >
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="normal" id="tab-group-normal" className="mt-1" />
                                                        <Label htmlFor="tab-group-normal" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Normal Tabs (Default)
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Restore groups as regular tabs without grouping
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="browserGroups" id="tab-group-browser" className="mt-1" />
                                                        <Label htmlFor="tab-group-browser" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Browser Tab Groups
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Use Chrome's native tab groups when restoring (Requires Chrome 88+)
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Pinned Tabs Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-thumbtack"></i>
                                            Pinned Tabs
                                        </h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                    Pinned tabs handling:
                                                </label>
                                                <RadioGroup
                                                    value={settings.pinnedTabsMode}
                                                    onValueChange={(value) => updatePinnedTabsMode(value as 'exclude' | 'include')}
                                                    className="space-y-3"
                                                >
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="exclude" id="pinned-exclude" className="mt-1" />
                                                        <Label htmlFor="pinned-exclude" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Don't send pinned tabs to BlueTab
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Use right-click menu to manually send individual pinned tabs
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="include" id="pinned-include" className="mt-1" />
                                                        <Label htmlFor="pinned-include" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Allow pinned tabs to be sent to BlueTab
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                BlueTab will remember if a tab was pinned when restoring
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Startup Behavior Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-rocket"></i>
                                            Startup Behavior
                                        </h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                    When browser starts:
                                                </label>
                                                <RadioGroup
                                                    value={settings.startupBehavior}
                                                    onValueChange={(value) => updateStartupBehavior(value as 'show' | 'manual')}
                                                    className="space-y-3"
                                                >
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="show" id="startup-show" className="mt-1" />
                                                        <Label htmlFor="startup-show" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Show BlueTab every time browser starts
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="manual" id="startup-manual" className="mt-1" />
                                                        <Label htmlFor="startup-manual" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Don't automatically open BlueTab
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Open BlueTab manually using the right-click menu or extension icon
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Custom New Tab Page Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-browser"></i>
                                            Custom New Tab Page
                                        </h3>

                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                                                <div className="flex-1">
                                                    <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block">
                                                        Enable Custom New Tab Page
                                                    </label>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                        Show a beautiful custom page when opening new tabs
                                                    </p>
                                                </div>
                                                <Switch
                                                    checked={settings.customNewTabEnabled || false}
                                                    onCheckedChange={updateCustomNewTabEnabled}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Context Menu Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-mouse-pointer"></i>
                                            Context Menu
                                        </h3>

                                        <div className="space-y-4">
                                            <div className="p-4 border border-border rounded-lg">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex-1">
                                                        <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block">
                                                            Groups in Right-Click Menu
                                                        </label>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                            Maximum number of groups shown in the context menu
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-lg font-semibold text-primary min-w-[40px] text-right">
                                                            {settings.contextMenuGroupLimit || 25}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="space-y-3">
                                                    <input
                                                        type="range"
                                                        min="5"
                                                        max="50"
                                                        step="5"
                                                        value={settings.contextMenuGroupLimit || 25}
                                                        onChange={(e) => updateContextMenuGroupLimit(parseInt(e.target.value))}
                                                        className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
                                                    />
                                                    <div className="flex justify-between text-xs text-gray-400">
                                                        <span>5</span>
                                                        <span>25</span>
                                                        <span>50</span>
                                                    </div>
                                                </div>
                                                {/* Warning for high values */}
                                                {(settings.contextMenuGroupLimit || 25) > 30 && (
                                                    <div className="mt-3 p-3 bg-warning-muted border-warning/30 rounded-lg flex items-start gap-2">
                                                        <i className="fas fa-exclamation-triangle text-warning text-sm mt-0.5"></i>
                                                        <p className="text-xs text-warning">
                                                            High values may affect context menu performance and usability. Consider keeping it below 30 for optimal experience.
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tab Restore Behavior Settings */}
                                    {/* Group Menu Personalization */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-ellipsis-v"></i>
                                            Group Menu Personalization
                                        </h3>

                                        <div className="space-y-4">
                                            <div className="p-4 border border-border rounded-lg">
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                                                    Drag to reorder. Each row includes visibility toggle. Submenus can be renamed, hidden, removed, or newly created.
                                                </p>

                                                {(() => {
                                                    const mergedConfig = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
                                                    const allLabels: Record<string, string> = {
                                                        groupInfo: 'Group Info',
                                                        archiveGroup: 'Archive Group',
                                                        assignToProject: 'Assign to Project',
                                                        deleteGroup: 'Delete Group',
                                                        manageTags: 'Manage Tags',
                                                        addNote: 'Add/Edit Note',
                                                        lockUnlock: 'Lock/Unlock',
                                                        rememberThisGroup: 'Remember This Group',
                                                        copyLinks: 'Copy Links',
                                                        shareToBluet: 'Share to Bluet',
                                                    };

                                                    // Visibility filter: hide items that can't appear in the actual menu
                                                    const canShowItem = (item: string) => {
                                                        if (item === 'rememberThisGroup') {
                                                            return settings.groupMemoryEnabled !== false && settings.groupMemoryAutoRemember === false;
                                                        }
                                                        if (item === 'shareToBluet') return isPro;
                                                        return true;
                                                    };

                                                    const mainOrderTokens = (mergedConfig.mainOrderV2 || []).filter(canShowItem);

                                                    return (
                                                        <div className="space-y-5">
                                                            <div className="flex items-center justify-between">
                                                                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Main Menu Layout</p>
                                                                <div className="flex items-center gap-2">
                                                                    <Button type="button" variant="outline" size="sm" onClick={addSubmenu}>
                                                                        Add Submenu
                                                                    </Button>
                                                                    <Button type="button" variant="outline" size="sm" onClick={resetGroupMenuConfig}>
                                                                        Reset Default
                                                                    </Button>
                                                                </div>
                                                            </div>

                                                            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleUnifiedDragEnd}>
                                                                <SortableContext items={mainOrderTokens} strategy={verticalListSortingStrategy}>
                                                                    <div className="space-y-2">
                                                                        {mainOrderTokens.map((token) => {
                                                                            const isSubmenu = token.startsWith('submenu:');
                                                                            const submenuId = isSubmenu ? token.replace('submenu:', '') : '';
                                                                            const submenu = isSubmenu ? (mergedConfig.submenus || []).find((s) => s.id === submenuId) : null;

                                                                            if (isSubmenu && !submenu) return null;

                                                                            return (
                                                                                <SortableMainMenuItem
                                                                                    key={token}
                                                                                    token={token}
                                                                                    isSubmenu={isSubmenu}
                                                                                    submenu={submenu || null}
                                                                                    label={allLabels[token] || token}
                                                                                    checked={isSubmenu ? Boolean(submenu?.visible) : Boolean((mergedConfig as Record<string, boolean>)[token])}
                                                                                    onToggleVisibility={(checked) => {
                                                                                        if (isSubmenu) {
                                                                                            toggleSubmenuVisibility(submenuId, checked);
                                                                                        } else {
                                                                                            updateGroupMenuItem(token, checked);
                                                                                        }
                                                                                    }}
                                                                                    onRename={isSubmenu ? (label) => renameSubmenu(submenuId, label) : undefined}
                                                                                    onRemove={isSubmenu ? () => removeSubmenu(submenuId) : undefined}
                                                                                />
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </SortableContext>

                                                                {(mergedConfig.submenus || []).map((submenu) => {
                                                                    const items = (mergedConfig.submenuItemOrder?.[submenu.id] || [])
                                                                        .filter((item) => mergedConfig.submenuAssignments?.[item] === submenu.id)
                                                                        .filter(canShowItem);

                                                                    return (
                                                                        <DroppableSubmenuZone key={submenu.id} id={submenu.id} label={submenu.label}>
                                                                            <SortableContext items={items} strategy={verticalListSortingStrategy}>
                                                                                {items.map((item) => (
                                                                                    <SortableSubmenuItem
                                                                                        key={item}
                                                                                        item={item}
                                                                                        submenuId={submenu.id}
                                                                                        label={allLabels[item] || item}
                                                                                        checked={Boolean((mergedConfig as Record<string, boolean>)[item])}
                                                                                        onToggle={(checked) => updateGroupMenuItem(item, checked)}
                                                                                    />
                                                                                ))}
                                                                            </SortableContext>
                                                                        </DroppableSubmenuZone>
                                                                    );
                                                                })}
                                                            </DndContext>
                                                        </div>
                                                    );
                                                })()}

                                                {!isPro && (
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                                                        Pro-only actions are hidden here until Pro is active.
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tab Restore Behavior Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-undo"></i>
                                            Tab Restore Behavior
                                        </h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                    When clicking 'Restore All' or restoring individual tabs:
                                                </label>
                                                <RadioGroup
                                                    value={settings.restoreBehavior}
                                                    onValueChange={(value) => updateRestoreBehavior(value as 'removeFromList' | 'keepInList')}
                                                    className="space-y-3"
                                                >
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="removeFromList" id="behavior-remove" className="mt-1" />
                                                        <Label htmlFor="behavior-remove" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Open tabs and remove from BlueTab list
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Use Ctrl/Cmd/Shift while clicking to restore without removing from list
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="keepInList" id="behavior-keep" className="mt-1" />
                                                        <Label htmlFor="behavior-keep" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Keep tabs in BlueTab list
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Manually delete entries using the X button or 'Delete All' button
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Save Behavior Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-save"></i>
                                            Save Behavior
                                        </h3>

                                        <div className="space-y-4">
                                            <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                <Switch
                                                    id="open-manager-after-save"
                                                    checked={settings.openManagerAfterSave ?? true}
                                                    onCheckedChange={async (checked) => {
                                                        const updatedSettings = { ...settings, openManagerAfterSave: checked };
                                                        await Storage.set('settings', updatedSettings);
                                                        setSettings(updatedSettings);
                                                    }}
                                                />
                                                <Label htmlFor="open-manager-after-save" className="flex-1 cursor-pointer space-y-1">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                        Open BlueTab after saving
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        When enabled, BlueTab manager opens automatically after saving tabs. When disabled, only a notification is shown.
                                                    </div>
                                                </Label>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tab URL Display */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-link"></i>
                                            Tab URL Display
                                        </h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                    How to display the URL under each tab title:
                                                </label>
                                                <RadioGroup
                                                    value={settings.tabUrlDisplay ?? 'full'}
                                                    onValueChange={(value) => updateTabUrlDisplay(value as 'full' | 'hostname')}
                                                    className="space-y-3"
                                                >
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="hostname" id="tab-url-hostname" className="mt-1" />
                                                        <Label htmlFor="tab-url-hostname" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Domain only
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Shows only the domain name (e.g. example.com)
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="full" id="tab-url-full" className="mt-1" />
                                                        <Label htmlFor="tab-url-full" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Full URL
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Shows the complete URL (e.g. https://example.com/path/page)
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Group Notes Display */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-sticky-note"></i>
                                            Group Notes Display
                                        </h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                    How to display notes on group cards:
                                                </label>
                                                <RadioGroup
                                                    value={settings.groupNotesDisplay ?? 'preview'}
                                                    onValueChange={(value) => updateGroupNotesDisplay(value as 'full' | 'preview')}
                                                    className="space-y-3"
                                                >
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="preview" id="notes-preview" className="mt-1" />
                                                        <Label htmlFor="notes-preview" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Truncated preview
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Shows a single line preview of the note text
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="full" id="notes-full" className="mt-1" />
                                                        <Label htmlFor="notes-full" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Full note text
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                Shows the complete note on the group card
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Browser Tabs Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-window-restore"></i>
                                            Browser Tabs
                                        </h3>

                                        <div className="space-y-4">
                                            <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                <Switch
                                                    id="browser-group-border"
                                                    checked={settings.browserTabsGroupBorder ?? true}
                                                    onCheckedChange={async (checked) => {
                                                        const updatedSettings = { ...settings, browserTabsGroupBorder: checked };
                                                        await Storage.set('settings', updatedSettings);
                                                        setSettings(updatedSettings);
                                                    }}
                                                />
                                                <Label htmlFor="browser-group-border" className="flex-1 cursor-pointer space-y-1">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                        Group colored border
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        Show a colored border around browser tab groups in the sidepanel matching the group color.
                                                    </div>
                                                </Label>
                                            </div>

                                            <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                <Switch
                                                    id="browser-close-on-save"
                                                    checked={settings.browserTabsCloseOnSave ?? true}
                                                    onCheckedChange={async (checked) => {
                                                        const updatedSettings = { ...settings, browserTabsCloseOnSave: checked };
                                                        await Storage.set('settings', updatedSettings);
                                                        setSettings(updatedSettings);
                                                    }}
                                                />
                                                <Label htmlFor="browser-close-on-save" className="flex-1 cursor-pointer space-y-1">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                        Close tabs after saving
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        Automatically close browser tabs after saving them to BlueTab or Archive from the sidepanel.
                                                    </div>
                                                </Label>
                                            </div>

                                            <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                <Switch
                                                    id="browser-inactive-indicator"
                                                    checked={settings.browserTabsShowInactiveIndicator ?? true}
                                                    onCheckedChange={async (checked) => {
                                                        const updatedSettings = { ...settings, browserTabsShowInactiveIndicator: checked };
                                                        await Storage.set('settings', updatedSettings);
                                                        setSettings(updatedSettings);
                                                    }}
                                                />
                                                <Label htmlFor="browser-inactive-indicator" className="flex-1 cursor-pointer space-y-1">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                        Inactive tab indicator
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        Show a warning icon on discarded/unloaded tabs in the sidepanel.
                                                    </div>
                                                </Label>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Group Memory Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-brain"></i>
                                            Group Memory
                                        </h3>

                                        <div className="space-y-4">
                                            <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                <Switch
                                                    id="memory-enabled"
                                                    checked={settings.groupMemoryEnabled ?? true}
                                                    onCheckedChange={async (checked) => {
                                                        const updatedSettings = { ...settings, groupMemoryEnabled: checked };
                                                        await Storage.set('settings', updatedSettings);
                                                        setSettings(updatedSettings);
                                                    }}
                                                />
                                                <Label htmlFor="memory-enabled" className="flex-1 cursor-pointer space-y-1">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                        Enable Group Memory
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        When a tab from a previously removed group is saved again, the group will be restored with its original name, color, and tags.
                                                    </div>
                                                </Label>
                                            </div>

                                            {(settings.groupMemoryEnabled ?? true) && (
                                                <div className="flex items-start space-x-3 p-3 border border-border rounded-lg ml-4">
                                                    <Switch
                                                        id="memory-auto"
                                                        checked={settings.groupMemoryAutoRemember ?? true}
                                                        onCheckedChange={async (checked) => {
                                                            const updatedSettings = { ...settings, groupMemoryAutoRemember: checked };
                                                            await Storage.set('settings', updatedSettings);
                                                            setSettings(updatedSettings);
                                                        }}
                                                    />
                                                    <Label htmlFor="memory-auto" className="flex-1 cursor-pointer space-y-1">
                                                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            Automatically remember all groups
                                                        </div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                            When disabled, groups won't be automatically remembered on restore.
                                                        </div>
                                                    </Label>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Floating Button Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-circle-plus"></i>
                                            Floating Button
                                        </h3>

                                        <div className="space-y-4">
                                            <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                <Switch
                                                    id="floating-enabled"
                                                    checked={settings.floatingButtonEnabled ?? true}
                                                    onCheckedChange={async (checked) => {
                                                        const updatedSettings = { ...settings, floatingButtonEnabled: checked };
                                                        await Storage.set('settings', updatedSettings);
                                                        setSettings(updatedSettings);
                                                        // Notify content scripts
                                                        chrome.tabs.query({}, (tabs) => {
                                                            tabs.forEach(tab => {
                                                                if (tab.id) {
                                                                    chrome.tabs.sendMessage(tab.id, {
                                                                        type: 'FLOATING_BUTTON_SETTINGS_CHANGED',
                                                                        settings: updatedSettings
                                                                    }).catch(() => {});
                                                                }
                                                            });
                                                        });
                                                    }}
                                                />
                                                <Label htmlFor="floating-enabled" className="flex-1 cursor-pointer space-y-1">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                        Show floating save button
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        Display a floating button on web pages for quick tab saving.
                                                    </div>
                                                </Label>
                                            </div>

                                            {(settings.floatingButtonEnabled ?? true) && (
                                                <>
                                                    <div className="p-3 border border-border rounded-lg ml-4">
                                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                            Button position:
                                                        </label>
                                                        <RadioGroup
                                                            value={settings.floatingButtonPosition ?? 'top-right'}
                                                            onValueChange={async (value) => {
                                                                const updatedSettings = { ...settings, floatingButtonPosition: value as any };
                                                                await Storage.set('settings', updatedSettings);
                                                                setSettings(updatedSettings);
                                                                // Notify content scripts
                                                                chrome.tabs.query({}, (tabs) => {
                                                                    tabs.forEach(tab => {
                                                                        if (tab.id) {
                                                                            chrome.tabs.sendMessage(tab.id, {
                                                                                type: 'FLOATING_BUTTON_SETTINGS_CHANGED',
                                                                                settings: updatedSettings
                                                                            }).catch(() => {});
                                                                        }
                                                                    });
                                                                });
                                                            }}
                                                            className="grid grid-cols-2 gap-2"
                                                        >
                                                            <div className="flex items-center space-x-2 p-2 border border-border rounded">
                                                                <RadioGroupItem value="top-left" id="pos-tl" />
                                                                <Label htmlFor="pos-tl" className="text-sm cursor-pointer">Top Left</Label>
                                                            </div>
                                                            <div className="flex items-center space-x-2 p-2 border border-border rounded">
                                                                <RadioGroupItem value="top-right" id="pos-tr" />
                                                                <Label htmlFor="pos-tr" className="text-sm cursor-pointer">Top Right</Label>
                                                            </div>
                                                            <div className="flex items-center space-x-2 p-2 border border-border rounded">
                                                                <RadioGroupItem value="bottom-left" id="pos-bl" />
                                                                <Label htmlFor="pos-bl" className="text-sm cursor-pointer">Bottom Left</Label>
                                                            </div>
                                                            <div className="flex items-center space-x-2 p-2 border border-border rounded">
                                                                <RadioGroupItem value="bottom-right" id="pos-br" />
                                                                <Label htmlFor="pos-br" className="text-sm cursor-pointer">Bottom Right</Label>
                                                            </div>
                                                        </RadioGroup>
                                                    </div>

                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg ml-4">
                                                        <Switch
                                                            id="floating-confirm"
                                                            checked={settings.floatingButtonConfirmSaveAll ?? true}
                                                            onCheckedChange={async (checked) => {
                                                                const updatedSettings = { ...settings, floatingButtonConfirmSaveAll: checked };
                                                                await Storage.set('settings', updatedSettings);
                                                                setSettings(updatedSettings);
                                                                // Notify content scripts
                                                                chrome.tabs.query({}, (tabs) => {
                                                                    tabs.forEach(tab => {
                                                                        if (tab.id) {
                                                                            chrome.tabs.sendMessage(tab.id, {
                                                                                type: 'FLOATING_BUTTON_SETTINGS_CHANGED',
                                                                                settings: updatedSettings
                                                                            }).catch(() => {});
                                                                        }
                                                                    });
                                                                });
                                                            }}
                                                        />
                                                        <Label htmlFor="floating-confirm" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Require confirmation for "Save All"
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                When enabled, long-press shows a tick icon that must be clicked to confirm saving all tabs.
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Duplicate Handling Settings */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-clone"></i>
                                            Duplicates
                                        </h3>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                                                    Duplicate URL handling:
                                                </label>
                                                <RadioGroup
                                                    value={settings.duplicateHandling}
                                                    onValueChange={(value) => updateDuplicateHandling(value as 'allow' | 'reject')}
                                                    className="space-y-3"
                                                >
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="allow" id="duplicate-allow" className="mt-1" />
                                                        <Label htmlFor="duplicate-allow" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Allow duplicates
                                                            </div>
                                                        </Label>
                                                    </div>
                                                    <div className="flex items-start space-x-3 p-3 border border-border rounded-lg">
                                                        <RadioGroupItem value="reject" id="duplicate-reject" className="mt-1" />
                                                        <Label htmlFor="duplicate-reject" className="flex-1 cursor-pointer space-y-1">
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Silently reject duplicates
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                If BlueTab already contains this URL, it won't be added again
                                                            </div>
                                                        </Label>
                                                    </div>
                                                </RadioGroup>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Backup & Data */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-shield-alt"></i>
                                            Backup
                                        </h3>

                                        <div className="flex flex-wrap gap-3">
                                            <Button
                                                onClick={exportData}
                                                className="flex-1 min-w-[150px] bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white"
                                            >
                                                <i className="fas fa-download mr-2"></i>
                                                Export JSON
                                            </Button>

                                            <Button
                                                onClick={exportAsHTML}
                                                className="flex-1 min-w-[150px] bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800 text-white"
                                            >
                                                <i className="fas fa-file-code mr-2"></i>
                                                Export HTML
                                            </Button>

                                            <Button
                                                asChild
                                                className="flex-1 min-w-[150px] bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 text-white"
                                            >
                                                <label className="cursor-pointer">
                                                    <i className="fas fa-upload mr-2"></i>
                                                    Import Data
                                                    <input type="file" accept=".json" onChange={importData} className="hidden" />
                                                </label>
                                            </Button>

                                            <Button
                                                onClick={() => setShowBookmarkImport(true)}
                                                className="flex-1 min-w-[150px] bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-800 text-white"
                                            >
                                                <i className="fas fa-bookmark mr-2"></i>
                                                Import Bookmarks
                                            </Button>

                                            <Button
                                                onClick={clearAllData}
                                                variant="danger"
                                                className="flex-1 min-w-[150px]"
                                            >
                                                <i className="fas fa-trash mr-2"></i>
                                                Clear All Data
                                            </Button>
                                        </div>
                                    </div>

                                    {/* About Section */}
                                    <div>
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                                            <i className="fas fa-info-circle"></i>
                                            About
                                        </h3>

                                        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
                                            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 text-center sm:text-left">
                                                <Logo size="splash" className="flex-shrink-0" />
                                                <div>
                                                    <p className="text-sm text-gray-600 dark:text-gray-400">Version 1.0.0</p>
                                                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 max-w-md">
                                                        One-click tab management for Chrome. Save, organize, and restore your browsing sessions with ease.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <Toaster richColors position="bottom-right" />
                <ConfirmModal
                    isOpen={showClearModal}
                    title="Clear All Data"
                    message="Are you sure you want to delete ALL groups and tabs permanently? This action cannot be undone!"
                    confirmText="Delete All"
                    cancelText="Cancel"
                    onConfirm={handleClearConfirm}
                    onCancel={() => setShowClearModal(false)}
                    type="danger"
                />
                <BookmarkImportModal
                    isOpen={showBookmarkImport}
                    onClose={() => setShowBookmarkImport(false)}
                    existingGroups={groups}
                    settings={settings}
                    onImportComplete={(newGroups) => {
                        setGroups(newGroups);
                        setStats({
                            totalGroups: newGroups.length,
                            totalTabs: newGroups.reduce((sum, g) => sum + g.tabs.length, 0)
                        });
                    }}
                />
            </SidebarInset>
        </SidebarProvider>
    );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
    <StrictMode>
        <SettingsPage />
    </StrictMode>
);