/**
 * Unit test for the "Save & close suspended tabs" helper exported from
 * TabsPanel.tsx.
 *
 * CONTEXT: This is the Phase 9 replacement surface for the scrapped
 * SuspendedTabsSection card — the one discoverable Bluetab-UI entry point
 * for "corral my suspended tabs AND tidy the tab strip." See 09-CONTEXT.md
 * §Safe Auto-Suspend and commit 542213e for the scope-reduction rationale.
 *
 * Fifth-iteration refinement: the menu item performs a unified save-and-close
 * in a single motion. SAFETY-01 is unaffected — that contract governs the
 * AutoSuspendService background scanner, not user-initiated UI handlers.
 *
 * Validation approach (Option B per 09-VALIDATION.md — Jest node env, no
 * jsdom): the pure helper returns a discriminated result; the tests drive
 * four outcomes × two paths (grouped & ungrouped):
 *   1. EMPTY   — zero discarded tabs → `{ kind: 'empty' }`, no storage write, no remove
 *   2. SAVED   — happy path → save AND close → `{ kind: 'saved', ..., closedCount: N }`
 *   3. SAVED-BUT-CLOSE-FAILED — save succeeds, chrome.tabs.remove throws →
 *                `{ kind: 'saved-but-close-failed', ..., error }`, save NOT undone
 *   4. ERROR   — storage write rejects → `{ kind: 'error', error }`, no remove
 */

import {
    saveSuspendedAsGroup,
    saveSuspendedFromUngrouped,
    type SaveSuspendedResult,
} from './TabsPanel';
import { Storage } from '../../utils/storage';
import type { BrowserTab } from '../hooks/useBrowserTabs';
import type { BrowserGroup } from '../hooks/useBrowserGroups';
import type { TabGroup } from '../../types/models';
import { initI18n } from '@/i18n';

jest.mock('../../utils/storage', () => ({
    Storage: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

const mockGet = Storage.get as jest.Mock;
const mockSet = Storage.set as jest.Mock;
const mockTabsRemove = chrome.tabs.remove as jest.Mock;

const NOW = 1_700_000_000_000;

beforeAll(async () => {
    await initI18n({ language: 'en' });
});

function tab(overrides: Partial<BrowserTab>): BrowserTab {
    return {
        id: 1,
        title: 'Tab',
        url: 'https://example.com/',
        favIconUrl: undefined,
        groupId: 1,
        pinned: false,
        discarded: false,
        active: false,
        windowId: 1,
        index: 0,
        ...overrides,
    };
}

function group(overrides: Partial<BrowserGroup>): BrowserGroup {
    return {
        id: 1,
        title: 'Work',
        color: 'blue',
        collapsed: false,
        windowId: 1,
        ...overrides,
    } as BrowserGroup;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue([]);
    mockSet.mockResolvedValue(undefined);
    mockTabsRemove.mockResolvedValue(undefined);
    // Deterministic crypto.randomUUID for older Node runtimes.
    if (!(globalThis.crypto as Crypto | undefined)?.randomUUID) {
        (globalThis as unknown as { crypto: Partial<Crypto> }).crypto = {
            ...(globalThis.crypto ?? {}),
            randomUUID: () => 'test-uuid-0000-0000-0000-000000000000',
        };
    }
});

describe('saveSuspendedAsGroup (grouped path)', () => {
    it('returns { kind: "empty" } when no tabs in the group are discarded — no storage write, no remove', async () => {
        const tabs = [
            tab({ id: 1, discarded: false }),
            tab({ id: 2, discarded: false }),
        ];

        const result: SaveSuspendedResult = await saveSuspendedAsGroup(
            group({ id: 1, title: 'Work' }),
            tabs,
            NOW,
        );

        expect(result).toEqual({ kind: 'empty' });
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockTabsRemove).not.toHaveBeenCalled();
    });

    it('saves discarded subset AND closes the saved source tabs (happy path)', async () => {
        const tabs = [
            tab({ id: 10, discarded: true, url: 'https://a.example/', title: 'A' }),
            tab({ id: 11, discarded: false, url: 'https://active.example/', title: 'Active' }),
            tab({ id: 12, discarded: true, url: 'https://b.example/', title: 'B' }),
        ];

        const result = await saveSuspendedAsGroup(
            group({ id: 1, title: 'Research' }),
            tabs,
            NOW,
        );

        expect(result.kind).toBe('saved');
        if (result.kind !== 'saved') throw new Error('unreachable');
        expect(result.count).toBe(2);
        expect(result.closedCount).toBe(2);
        expect(result.groupName).toContain('Suspended from "Research"');

        // Storage.set called exactly once with a TabGroup whose tabs are the
        // discarded subset, in original order, with URLs and titles preserved.
        expect(mockSet).toHaveBeenCalledTimes(1);
        const [key, value] = mockSet.mock.calls[0];
        expect(key).toBe('groups');
        const savedGroups = value as TabGroup[];
        const newGroup = savedGroups[savedGroups.length - 1];
        expect(newGroup.tabs).toHaveLength(2);
        expect(newGroup.tabs.map((t) => t.url)).toEqual([
            'https://a.example/',
            'https://b.example/',
        ]);

        // chrome.tabs.remove called with the saved-subset tab IDs (NOT the
        // active tab 11). User-initiated remove, outside SAFETY-01's scope
        // (which governs AutoSuspendService only).
        expect(mockTabsRemove).toHaveBeenCalledTimes(1);
        expect(mockTabsRemove).toHaveBeenCalledWith([10, 12]);
    });

    it('returns "saved-but-close-failed" when chrome.tabs.remove throws — save is NOT undone', async () => {
        mockTabsRemove.mockRejectedValueOnce(new Error('No tab with id: 20'));
        const tabs = [
            tab({ id: 20, discarded: true, url: 'https://c.example/' }),
        ];

        const result = await saveSuspendedAsGroup(
            group({ id: 1, title: 'Flaky' }),
            tabs,
            NOW,
        );

        expect(result.kind).toBe('saved-but-close-failed');
        if (result.kind !== 'saved-but-close-failed') throw new Error('unreachable');
        expect(result.count).toBe(1);
        expect(result.groupName).toContain('Suspended from "Flaky"');
        expect((result.error as Error).message).toBe('No tab with id: 20');

        // Save still happened — saved group remains intact.
        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockTabsRemove).toHaveBeenCalledTimes(1);
    });

    it('returns { kind: "error" } when storage write rejects — chrome.tabs.remove NOT invoked', async () => {
        mockSet.mockRejectedValueOnce(new Error('quota exceeded'));
        const tabs = [tab({ id: 30, discarded: true })];

        const result = await saveSuspendedAsGroup(group({}), tabs, NOW);

        expect(result.kind).toBe('error');
        if (result.kind !== 'error') throw new Error('unreachable');
        expect((result.error as Error).message).toBe('quota exceeded');
        // If the save itself failed we must not close source tabs — otherwise
        // the user loses tabs without the corralled group to restore them from.
        expect(mockTabsRemove).not.toHaveBeenCalled();
    });

    it('preserves existing groups when appending the new one', async () => {
        const existing: TabGroup[] = [
            { id: 'old-1', name: 'Old', tabs: [], created: 1, modified: 1 },
        ];
        mockGet.mockResolvedValue(existing);
        const tabs = [tab({ id: 40, discarded: true })];

        await saveSuspendedAsGroup(group({}), tabs, NOW);

        const [, value] = mockSet.mock.calls[0];
        const savedGroups = value as TabGroup[];
        expect(savedGroups).toHaveLength(2);
        expect(savedGroups[0]).toEqual(existing[0]);
    });
});

describe('saveSuspendedFromUngrouped (ungrouped path)', () => {
    it('returns { kind: "empty" } when no ungrouped tabs are discarded — no storage write, no remove', async () => {
        const tabs = [
            tab({ id: 50, discarded: false }),
            tab({ id: 51, discarded: false }),
        ];

        const result: SaveSuspendedResult = await saveSuspendedFromUngrouped(tabs, NOW);

        expect(result).toEqual({ kind: 'empty' });
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockTabsRemove).not.toHaveBeenCalled();
    });

    it('saves discarded subset AND closes the saved source tabs under an "Ungrouped" label', async () => {
        const tabs = [
            tab({ id: 60, discarded: true, url: 'https://u1.example/', title: 'U1' }),
            tab({ id: 61, discarded: false, url: 'https://active.example/', title: 'Active' }),
            tab({ id: 62, discarded: true, url: 'https://u2.example/', title: 'U2' }),
        ];

        const result = await saveSuspendedFromUngrouped(tabs, NOW);

        expect(result.kind).toBe('saved');
        if (result.kind !== 'saved') throw new Error('unreachable');
        expect(result.count).toBe(2);
        expect(result.closedCount).toBe(2);
        expect(result.groupName).toContain('Suspended from "Ungrouped"');

        expect(mockSet).toHaveBeenCalledTimes(1);
        const [key, value] = mockSet.mock.calls[0];
        expect(key).toBe('groups');
        const savedGroups = value as TabGroup[];
        const newGroup = savedGroups[savedGroups.length - 1];
        expect(newGroup.tabs).toHaveLength(2);
        expect(newGroup.tabs.map((t) => t.url)).toEqual([
            'https://u1.example/',
            'https://u2.example/',
        ]);

        expect(mockTabsRemove).toHaveBeenCalledTimes(1);
        expect(mockTabsRemove).toHaveBeenCalledWith([60, 62]);
    });

    it('returns "saved-but-close-failed" when chrome.tabs.remove throws — save is NOT undone', async () => {
        mockTabsRemove.mockRejectedValueOnce(new Error('Tabs cannot be edited right now'));
        const tabs = [tab({ id: 70, discarded: true })];

        const result = await saveSuspendedFromUngrouped(tabs, NOW);

        expect(result.kind).toBe('saved-but-close-failed');
        if (result.kind !== 'saved-but-close-failed') throw new Error('unreachable');
        expect(result.count).toBe(1);
        expect(result.groupName).toContain('Suspended from "Ungrouped"');
        expect((result.error as Error).message).toBe('Tabs cannot be edited right now');

        expect(mockSet).toHaveBeenCalledTimes(1);
    });

    it('returns { kind: "error" } when storage write rejects — chrome.tabs.remove NOT invoked', async () => {
        mockSet.mockRejectedValueOnce(new Error('quota exceeded'));
        const tabs = [tab({ id: 80, discarded: true })];

        const result = await saveSuspendedFromUngrouped(tabs, NOW);

        expect(result.kind).toBe('error');
        if (result.kind !== 'error') throw new Error('unreachable');
        expect((result.error as Error).message).toBe('quota exceeded');
        expect(mockTabsRemove).not.toHaveBeenCalled();
    });
});
