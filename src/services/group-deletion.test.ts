import { deleteGroupsWithUndo, GROUP_UNDO_MS } from './group-deletion';
import { Storage } from '@/utils/storage';
import { GroupMemoryStorageService } from '@/utils/group-memory-storage';
import type { TabGroup } from '@/types/models';

const group = (id: string): TabGroup => ({
    id, name: id, color: 'blue', tags: ['work'], created: 1, modified: 1,
    tabs: [{ id: `tab-${id}`, groupId: id, url: `https://${id}.example/`, title: id, timestamp: 1 }],
});
let data: Record<string, unknown>;
beforeEach(() => {
    jest.useFakeTimers();
    data = { groups: ['a', 'b', 'c', 'd'].map(group) };
    jest.spyOn(Storage, 'get').mockImplementation(async key => JSON.parse(JSON.stringify(data[key] ?? null)));
    jest.spyOn(Storage, 'set').mockImplementation(async (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it('immediately deletes and then restores the exact group, memory record and URL index', async () => {
    data.pinSettings = { pinnedGroups: { b: { isPinned: true, pinnedAt: 123 } } };
    await GroupMemoryStorageService.rememberGroup(group('b'));
    const memory = await GroupMemoryStorageService.getMemory();
    const receipt = await deleteGroupsWithUndo(['b']);
    expect(receipt.updatedGroups.map(g => g.id)).toEqual(['a', 'c', 'd']);
    expect(data.pinSettings).toEqual({ pinnedGroups: {} });
    expect((await GroupMemoryStorageService.getMemory()).groups.b).toBeUndefined();
    expect(await receipt.undo()).toBe(true);
    expect(data.groups).toEqual(['a', 'b', 'c', 'd'].map(group));
    expect(await GroupMemoryStorageService.getMemory()).toEqual(memory);
    expect(data.pinSettings).toEqual({ pinnedGroups: { b: { isPinned: true, pinnedAt: 123 } } });
    expect(await receipt.undo()).toBe(false);
});

it('bulk undo preserves later changes and restores original relative positions', async () => {
    await GroupMemoryStorageService.rememberGroup(group('b'));
    await GroupMemoryStorageService.rememberGroup(group('c'));
    const receipt = await deleteGroupsWithUndo(['b', 'c']);
    expect(receipt.count).toBe(2);
    data.groups = [group('new'), { ...group('a'), name: 'Edited later' }, group('d')];
    await GroupMemoryStorageService.rememberGroup(group('new'));
    await receipt.undo();
    expect((data.groups as TabGroup[]).map(g => g.id)).toEqual(['new', 'a', 'b', 'c', 'd']);
    expect((data.groups as TabGroup[])[1].name).toBe('Edited later');
    expect(Object.keys((await GroupMemoryStorageService.getMemory()).groups).sort()).toEqual(['b', 'c', 'new']);
});

it('expires after ten seconds and leaves the deletion in place', async () => {
    const receipt = await deleteGroupsWithUndo(['a']);
    jest.advanceTimersByTime(GROUP_UNDO_MS);
    expect(await receipt.undo()).toBe(false);
    expect((data.groups as TabGroup[]).map(g => g.id)).toEqual(['b', 'c', 'd']);
});

it('does not delete locked groups or duplicate a group recreated before undo', async () => {
    data.groups = [{ ...group('a'), locked: true }, group('b')];
    const receipt = await deleteGroupsWithUndo(['a', 'b']);
    expect(receipt.count).toBe(1);
    data.groups = [{ ...group('a'), locked: true }, { ...group('b'), name: 'Recreated' }];
    await receipt.undo();
    expect((data.groups as TabGroup[]).map(g => g.name)).toEqual(['a', 'Recreated']);
});
