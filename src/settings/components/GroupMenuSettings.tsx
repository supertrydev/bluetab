import { useState, useEffect, useRef, useCallback } from 'react';
import {
    GripVertical, Trash2, EllipsisVertical, Plus, RotateCcw,
    Send, Info, Archive, FolderPlus, Bell, Download, Tags, StickyNote,
    Lock, Brain, Copy, Menu, Share2, type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ProBadge } from '@/components/auth/ProBadge';
import { ToastManager } from '@/components/Toast';
import { ENABLE_READINGS } from '@/config/feature-flags';
import { Storage } from '@/utils/storage';
import {
    getDefaultGroupMenuConfig,
    getNormalizedGroupMenuConfig,
} from '@/utils/sorting';
import { getGroupSubmenuLabel } from '@/utils/group-menu-labels';
import type { GroupMenuSubmenuItem, Settings } from '@/types/models';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
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
import { isolateBidi } from '@/i18n/bidi';

// --- Debounced input to avoid storage writes on every keystroke ---

function DebouncedInput({ value, onDebouncedChange, className, ariaLabel }: {
    value: string;
    onDebouncedChange: (val: string) => void;
    className?: string;
    ariaLabel?: string;
}) {
    const [local, setLocal] = useState(value);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();
    const onChangeRef = useRef(onDebouncedChange);
    onChangeRef.current = onDebouncedChange;

    useEffect(() => { setLocal(value); }, [value]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const next = e.target.value;
        setLocal(next);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => onChangeRef.current(next), 400);
    }, []);

    // Flush a pending rename on blur so leaving the page right after typing
    // does not drop the change (the unmount cleanup only clears the timer).
    const handleBlur = useCallback(() => {
        if (timerRef.current === undefined) return;
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
        if (local !== value) onChangeRef.current(local);
    }, [local, value]);

    useEffect(() => () => clearTimeout(timerRef.current), []);

    return (
        <input
            dir="auto"
            value={local}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            aria-label={ariaLabel}
            className={className}
        />
    );
}

// --- Sortable components for Group Menu Personalization ---

/** Same icons the real 3-dot group menu uses, so the list reads like the menu. */
const ITEM_ICONS: Record<string, LucideIcon> = {
    integrations: Send,
    groupInfo: Info,
    archiveGroup: Archive,
    assignToProject: FolderPlus,
    setReminder: Bell,
    saveOffline: Download,
    deleteGroup: Trash2,
    manageTags: Tags,
    addNote: StickyNote,
    lockUnlock: Lock,
    rememberThisGroup: Brain,
    copyLinks: Copy,
    shareToBluet: Send,
};

const SUBMENU_ITEM_KEYS: GroupMenuSubmenuItem[] = ['manageTags', 'addNote', 'lockUnlock', 'rememberThisGroup', 'copyLinks', 'shareToBluet'];
const BUILT_IN_SUBMENUS = new Set(['edit', 'share']);

interface MenuRowProps {
    id: string;
    zone: string;
    icon: LucideIcon;
    label: React.ReactNode;
    hint?: string;
    checked: boolean;
    switchDisabled?: boolean;
    showProBadge?: boolean;
    danger?: boolean;
    onToggle: (checked: boolean) => void;
    trailing?: React.ReactNode;
}

function SortableMenuRow({
    id,
    zone,
    icon: Icon,
    label,
    hint,
    checked,
    switchDisabled,
    showProBadge,
    danger,
    onToggle,
    trailing,
}: MenuRowProps) {
    const { t } = useTranslation();
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, data: { zone } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className={`group flex min-h-10 items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-bg-2/70 ${isDragging ? 'relative z-50 bg-bg-2 shadow-lg' : ''}`}
        >
            <button
                type="button"
                ref={setActivatorNodeRef}
                {...listeners}
                className="touch-none rounded-full p-1 text-text-muted opacity-50 transition-opacity hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing"
                aria-label={t('settings.groupMenu.dragAria')}
            >
                <GripVertical className="h-4 w-4" />
            </button>
            <Icon className={`h-4 w-4 shrink-0 ${danger ? 'text-danger' : 'text-text-muted'} ${checked ? '' : 'opacity-40'}`} />
            <div className={`flex min-w-0 flex-1 items-center gap-2 ${checked ? '' : 'opacity-50'}`}>
                <span className={`min-w-0 truncate text-sm ${danger ? 'text-danger' : 'text-text-strong'}`}>{label}</span>
                {showProBadge && <ProBadge size="sm" />}
                {hint && <span className="hidden min-w-0 truncate text-xs text-text-muted sm:inline">{hint}</span>}
            </div>
            {trailing}
            <Switch
                checked={checked}
                disabled={switchDisabled}
                onCheckedChange={onToggle}
            />
        </div>
    );
}

/** Children of a submenu, drawn right under the submenu row like the real flyout. */
function DroppableSubmenuZone({ id, isEmpty, children }: { id: string; isEmpty: boolean; children: React.ReactNode }) {
    const { t } = useTranslation();
    const { setNodeRef, isOver } = useDroppable({ id });
    return (
        <div
            ref={setNodeRef}
            className={`ms-5 border-s ps-2 transition-colors ${isOver ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
            {isEmpty ? (
                <p className="px-2 py-2 text-xs text-text-muted">{t('settings.groupMenu.emptySubmenu')}</p>
            ) : children}
        </div>
    );
}

// --- Main GroupMenuSettings component ---

export interface GroupMenuSettingsProps {
    settings: Settings;
    isPro: boolean;
    onSettingsChange: (updated: Settings) => void;
}

export function GroupMenuSettings({ settings, isPro, onSettingsChange }: GroupMenuSettingsProps) {
    const { t } = useTranslation();
    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const saveGroupMenuConfig = async (nextConfig: ReturnType<typeof getNormalizedGroupMenuConfig>) => {
        const updatedSettings = { ...settings, groupMenuConfig: nextConfig };
        await Storage.set('settings', updatedSettings);
        onSettingsChange(updatedSettings);
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
            ToastManager.getInstance().error(t('settings.groupMenu.saveError', { message: isolateBidi((error as Error).message) }));
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
        const targetOrder = [...(nextOrder[targetSubmenuId] || [])].filter((entry) => entry !== dragItem);

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

    const [activeDragId, setActiveDragId] = useState<string | null>(null);

    const handleUnifiedDragEnd = async (event: DragEndEvent) => {
        setActiveDragId(null);
        const { active, over } = event;
        if (!over) return;

        const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
        const sourceZone = (active.data.current as { zone?: string })?.zone || '';
        let targetZone = (over.data.current as { zone?: string })?.zone || (over.id as string);
        const activeId = active.id as string;
        let overId = over.id as string;

        if (activeId === overId) return;

        const submenuItemKeys: string[] = SUBMENU_ITEM_KEYS;

        // Dropping an action onto a submenu row puts it inside that submenu
        // (the children are drawn under the row, so that is what users expect).
        if (targetZone === '__main__' && overId.startsWith('submenu:') && sourceZone !== '__main__') {
            targetZone = overId.replace('submenu:', '');
            overId = targetZone;
        }

        if (sourceZone === '__main__' && targetZone === '__main__') {
            const order = [...(normalized.mainOrderV2 || [])];
            const oldIdx = order.indexOf(activeId);
            const newIdx = order.indexOf(overId);
            if (oldIdx < 0 || newIdx < 0) return;
            await saveGroupMenuConfig({ ...normalized, mainOrderV2: arrayMove(order, oldIdx, newIdx) });

        } else if (sourceZone !== '__main__' && targetZone === '__main__') {
            const dragItem = activeId as GroupMenuSubmenuItem;
            const mainOrder = [...(normalized.mainOrderV2 || [])];
            const insertIdx = mainOrder.indexOf(overId);
            if (insertIdx < 0) mainOrder.push(dragItem);
            else mainOrder.splice(insertIdx, 0, dragItem);
            const srcOrder = [...(normalized.submenuItemOrder?.[sourceZone] || [])].filter(i => i !== dragItem);
            await saveGroupMenuConfig({
                ...normalized,
                mainOrderV2: mainOrder,
                submenuItemOrder: { ...(normalized.submenuItemOrder || {}), [sourceZone]: srcOrder },
            });

        } else if (sourceZone === '__main__' && targetZone !== '__main__') {
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
            const order = [...(normalized.submenuItemOrder?.[sourceZone] || [])];
            const oldIdx = order.indexOf(activeId as GroupMenuSubmenuItem);
            const newIdx = order.indexOf(overId as GroupMenuSubmenuItem);
            if (oldIdx < 0 || newIdx < 0) return;
            await saveGroupMenuConfig({
                ...normalized,
                submenuItemOrder: { ...(normalized.submenuItemOrder || {}), [sourceZone]: arrayMove(order, oldIdx, newIdx) },
            });

        } else {
            await moveSubmenuItem(sourceZone, targetZone, activeId as GroupMenuSubmenuItem,
                (over.data.current as { zone?: string })?.zone ? overId as GroupMenuSubmenuItem : undefined);
        }
    };

    const addSubmenu = async () => {
        try {
            const normalized = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
            const newId = `submenu_${Date.now()}`;
            const submenus = [...(normalized.submenus || []), { id: newId, label: t('settings.groupMenu.newSubmenuLabel'), visible: true }];
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
            ToastManager.getInstance().error(t('settings.groupMenu.addError', { message: isolateBidi((error as Error).message) }));
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
                ToastManager.getInstance().error(t('settings.groupMenu.requireOne'));
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
            ToastManager.getInstance().error(t('settings.groupMenu.removeError', { message: isolateBidi((error as Error).message) }));
        }
    };

    const resetGroupMenuConfig = async () => {
        try {
            await saveGroupMenuConfig(getDefaultGroupMenuConfig());
            ToastManager.getInstance().success(t('settings.groupMenu.resetSuccess'));
        } catch (error) {
            ToastManager.getInstance().error(t('settings.groupMenu.resetError', { message: isolateBidi((error as Error).message) }));
        }
    };

    const mergedConfig = getNormalizedGroupMenuConfig(settings.groupMenuConfig);
    const configFlags = mergedConfig as unknown as Record<string, boolean>;
    const allLabels: Record<string, string> = {
        integrations: t('settings.groupMenu.labels.integrations'),
        groupInfo: t('settings.groupMenu.labels.groupInfo'),
        archiveGroup: t('settings.groupMenu.labels.archiveGroup'),
        assignToProject: t('settings.groupMenu.labels.assignToProject'),
        setReminder: t('settings.groupMenu.labels.setReminder'),
        saveOffline: t('settings.groupMenu.labels.saveOffline'),
        deleteGroup: t('settings.groupMenu.labels.deleteGroup'),
        manageTags: t('settings.groupMenu.labels.manageTags'),
        addNote: t('settings.groupMenu.labels.addNote'),
        lockUnlock: t('settings.groupMenu.labels.lockUnlock'),
        rememberThisGroup: t('settings.groupMenu.labels.rememberThisGroup'),
        copyLinks: t('settings.groupMenu.labels.copyLinks'),
        shareToBluet: t('settings.groupMenu.labels.shareToBluet'),
    };

    // Only feature-flagged actions are left out. Conditional actions stay in
    // the list with a hint, so the list always matches what the menu can show.
    const canShowItem = (item: string) => {
        if (item === 'saveOffline') return ENABLE_READINGS;
        return true;
    };

    const rememberAvailable = settings.groupMemoryEnabled !== false && settings.groupMemoryAutoRemember === false;
    const getItemHint = (item: string): string | undefined => {
        if (item === 'integrations') return t('settings.groupMenu.integrationsHint');
        if (item === 'assignToProject') return t('settings.groupMenu.projectsHint');
        if (item === 'rememberThisGroup' && !rememberAvailable) return t('settings.groupMenu.rememberHint');
        return undefined;
    };

    const renderActionRow = (item: string, zone: string) => {
        const proLocked = item === 'shareToBluet' && !isPro;
        return (
            <SortableMenuRow
                key={item}
                id={item}
                zone={zone}
                icon={ITEM_ICONS[item] || Menu}
                label={<bdi dir="auto">{allLabels[item] || item}</bdi>}
                hint={getItemHint(item)}
                checked={!proLocked && Boolean(configFlags[item])}
                switchDisabled={proLocked}
                showProBadge={proLocked}
                danger={item === 'deleteGroup'}
                onToggle={(checked) => updateGroupMenuItem(item, checked)}
            />
        );
    };

    const mainOrderTokens = (mergedConfig.mainOrderV2 || []).filter(canShowItem);

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-text-strong flex items-center gap-2">
                        <EllipsisVertical className="w-5 h-5" />
                        {t('settings.groupMenu.title')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                        {t('settings.groupMenu.description')}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={addSubmenu}>
                        <Plus className="h-3.5 w-3.5" />
                        {t('settings.groupMenu.addSubmenu')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={resetGroupMenuConfig}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('settings.groupMenu.resetDefault')}
                    </Button>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-bg-1/60 p-1.5">
                <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    onDragStart={(event: DragStartEvent) => setActiveDragId(event.active.id as string)}
                    onDragCancel={() => setActiveDragId(null)}
                    onDragEnd={handleUnifiedDragEnd}
                >
                    <SortableContext items={mainOrderTokens} strategy={verticalListSortingStrategy}>
                        {mainOrderTokens.map((token, index) => {
                            // Mirrors the separator the real menu draws above Delete Group.
                            const separator = token === 'deleteGroup' && index > 0
                                ? <div className="mx-2 my-1 border-t border-border" />
                                : null;

                            if (!token.startsWith('submenu:')) {
                                return (
                                    <div key={token}>
                                        {separator}
                                        {renderActionRow(token, '__main__')}
                                    </div>
                                );
                            }

                            const submenuId = token.replace('submenu:', '');
                            const submenu = (mergedConfig.submenus || []).find((s) => s.id === submenuId);
                            if (!submenu) return null;

                            const isShare = submenuId === 'share';
                            const items = (mergedConfig.submenuItemOrder?.[submenuId] || [])
                                .filter((item) => mergedConfig.submenuAssignments?.[item] === submenuId)
                                .filter(canShowItem);
                            const canRemove = !BUILT_IN_SUBMENUS.has(submenuId);

                            return (
                                <div key={token}>
                                    <SortableMenuRow
                                        id={token}
                                        zone="__main__"
                                        icon={isShare ? Share2 : Menu}
                                        label={
                                            <DebouncedInput
                                                value={getGroupSubmenuLabel(submenu, t)}
                                                onDebouncedChange={(val) => renameSubmenu(submenuId, val)}
                                                ariaLabel={t('settings.groupMenu.renameAria')}
                                                className="w-full min-w-0 rounded bg-transparent px-1 -mx-1 text-sm font-medium text-text-strong hover:bg-accent focus:bg-bg-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                                            />
                                        }
                                        hint={isShare ? t('settings.groupMenu.shareExtrasHint') : undefined}
                                        checked={Boolean(submenu.visible)}
                                        onToggle={(checked) => toggleSubmenuVisibility(submenuId, checked)}
                                        trailing={canRemove ? (
                                            <button
                                                type="button"
                                                onClick={() => removeSubmenu(submenuId)}
                                                className="rounded-full p-1.5 text-text-muted opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                                                aria-label={t('settings.groupMenu.removeSubmenu')}
                                                title={t('settings.groupMenu.removeSubmenu')}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        ) : undefined}
                                    />
                                    {activeDragId !== token && (
                                        <DroppableSubmenuZone id={submenuId} isEmpty={items.length === 0}>
                                            <SortableContext items={items} strategy={verticalListSortingStrategy}>
                                                {items.map((item) => renderActionRow(item, submenuId))}
                                            </SortableContext>
                                        </DroppableSubmenuZone>
                                    )}
                                </div>
                            );
                        })}
                    </SortableContext>
                </DndContext>
            </div>
        </div>
    );
}
