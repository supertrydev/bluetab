import type { TabGroup, PinSettings } from '@/types/models';
import { Storage } from '@/utils/storage';
import { GroupMemoryStorageService } from '@/utils/group-memory-storage';

export const GROUP_UNDO_MS = 10_000;

/** The receipt lives only in this page and releases deleted data after ten seconds. */
export async function deleteGroupsWithUndo(groupIds: Iterable<string>) {
    const ids = new Set(groupIds);
    let originalOrder: string[] = [];
    let deleted: TabGroup[] = [];
    let memory = await GroupMemoryStorageService.getMemory();
    const updatedGroups = await Storage.atomicUpdate<TabGroup[]>('groups', (current) => {
        const original = current || [];
        originalOrder = original.map(group => group.id);
        deleted = original.filter(group => ids.has(group.id) && !group.locked);
        const deletedIds = new Set(deleted.map(group => group.id));
        return original.filter(group => !deletedIds.has(group.id));
    }, []);
    // Retain only records belonging to this deletion, never an old copy of all memory.
    const deletedIds = new Set(deleted.map(group => group.id));
    memory = {
        groups: Object.fromEntries(Object.entries(memory.groups).filter(([id]) => deletedIds.has(id))),
        urlIndex: Object.fromEntries(Object.entries(memory.urlIndex).filter(([, id]) => deletedIds.has(id))),
    };
    for (const group of deleted) await GroupMemoryStorageService.forgetGroup(group.id);

    let pins: PinSettings['pinnedGroups'] = {};
    await Storage.atomicUpdate<PinSettings>('pinSettings', current => {
        const pinnedGroups = { ...current?.pinnedGroups };
        for (const id of deletedIds) {
            if (pinnedGroups[id]) pins[id] = pinnedGroups[id];
            delete pinnedGroups[id];
        }
        return { ...current, pinnedGroups };
    }, { pinnedGroups: {} });

    const count = deleted.length;
    const expiresAt = Date.now() + GROUP_UNDO_MS;
    let available = true;
    const release = () => {
        available = false;
        originalOrder = [];
        deleted = [];
        pins = {};
        memory = { groups: {}, urlIndex: {} };
    };
    let timer = setTimeout(release, GROUP_UNDO_MS);
    return {
        updatedGroups,
        count,
        expiresAt,
        async undo(): Promise<boolean> {
            if (!available || Date.now() >= expiresAt) return false;
            available = false;
            clearTimeout(timer);
            try {
                await Storage.atomicUpdate<TabGroup[]>('groups', (current) => {
                    const next = [...(current || [])];
                    for (const group of deleted) {
                        if (next.some(candidate => candidate.id === group.id)) continue;
                        const position = originalOrder.indexOf(group.id);
                        const following = originalOrder.slice(position + 1).find(id => next.some(item => item.id === id));
                        const preceding = originalOrder.slice(0, position).reverse().find(id => next.some(item => item.id === id));
                        const index = following ? next.findIndex(item => item.id === following)
                            : preceding ? next.findIndex(item => item.id === preceding) + 1
                                : Math.min(position, next.length);
                        next.splice(index, 0, group);
                    }
                    return next;
                }, []);
                await Storage.atomicUpdate<Awaited<ReturnType<typeof GroupMemoryStorageService.getMemory>>>('groupMemory', current => ({
                    groups: { ...memory.groups, ...current?.groups },
                    urlIndex: { ...memory.urlIndex, ...current?.urlIndex },
                }));
                await Storage.atomicUpdate<PinSettings>('pinSettings', current => ({
                    ...current,
                    pinnedGroups: { ...pins, ...current?.pinnedGroups },
                }), { pinnedGroups: {} });
                release();
                return true;
            } catch (error) {
                available = Date.now() < expiresAt;
                timer = setTimeout(release, Math.max(0, expiresAt - Date.now()));
                throw error;
            }
        },
    };
}
