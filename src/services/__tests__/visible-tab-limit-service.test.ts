/**
 * VisibleTabLimitService tests — covers ADHD-10, ADHD-11.
 *
 * Requirements:
 *   ADHD-10: User can set a visible tab limit (default 20, slider 5–30).
 *   ADHD-11: Overflow tabs move into collapsed H:* browser groups; never closed.
 *   ADHD-12: Safety checked in safety-contracts.adhd12.test.ts (source-grep).
 *
 * Chrome API mock pattern mirrors auto-suspend-service.safety.test.ts (Phase 9).
 * Uses jest.clearAllMocks() in beforeEach.
 */

import { VisibleTabLimitService, HIDDEN_GROUP_TITLE, HIDDEN_GROUP_PREFIX, VTL_TAB_METADATA_KEY, onHiddenGroupUserExpanded } from '@/services/visible-tab-limit-service';
import { ADHDService } from '@/services/adhd-service';
import { DEFAULT_ADHD_SETTINGS, type ADHDSettings } from '@/types/adhd';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/services/adhd-service', () => ({
  ADHDService: {
    getSettings: jest.fn(),
  },
}));

// Mock storage to capture vtl_tab_metadata writes
jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  },
}));

import { Storage } from '@/utils/storage';

const mockGetSettings = ADHDService.getSettings as jest.Mock;
const mockStorageGet = Storage.get as jest.Mock;
const mockStorageSet = Storage.set as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<ADHDSettings> = {}): ADHDSettings {
  return {
    ...DEFAULT_ADHD_SETTINGS,
    masterEnabled: true,
    ...overrides,
    visibleTabLimit: {
      enabled: true,
      limit: 20,
      ...(overrides.visibleTabLimit ?? {}),
    },
  };
}

/** Build a minimal chrome.tabs.Tab fixture. */
function makeTab(
  id: number,
  opts: {
    pinned?: boolean;
    groupId?: number;
    lastAccessed?: number;
    active?: boolean;
    windowId?: number;
  } = {},
): chrome.tabs.Tab {
  return {
    id,
    index: id,
    windowId: opts.windowId ?? 1,
    highlighted: false,
    active: opts.active ?? false,
    pinned: opts.pinned ?? false,
    audible: false,
    discarded: false,
    autoDiscardable: true,
    incognito: false,
    selected: false,
    groupId: opts.groupId ?? -1,
    lastAccessed: opts.lastAccessed ?? (1_000_000 - id * 1000), // higher id = older
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
  } as chrome.tabs.Tab;
}

/** Build a minimal chrome.tabGroups.TabGroup fixture. */
function makeGroup(
  id: number,
  opts: { title?: string; collapsed?: boolean; color?: chrome.tabGroups.ColorEnum } = {},
): chrome.tabGroups.TabGroup {
  return {
    id,
    windowId: 1,
    title: opts.title ?? `Group ${id}`,
    collapsed: opts.collapsed ?? false,
    color: opts.color ?? ('blue' as chrome.tabGroups.ColorEnum),
  };
}

// ---------------------------------------------------------------------------
// ADHD-10: Settings (handled via DEFAULT_ADHD_SETTINGS and clampLimit)
// ---------------------------------------------------------------------------

describe('VisibleTabLimitService — settings (ADHD-10)', () => {
  test('ADHD-10: enabled default false, limit default 20', () => {
    const s = DEFAULT_ADHD_SETTINGS;
    expect(s.visibleTabLimit.enabled).toBe(false);
    expect(s.visibleTabLimit.limit).toBe(20);
  });

  test('ADHD-10: clampLimit clamps value to 5..30', () => {
    expect(VisibleTabLimitService.clampLimit(2)).toBe(5);   // below floor
    expect(VisibleTabLimitService.clampLimit(5)).toBe(5);   // at floor
    expect(VisibleTabLimitService.clampLimit(20)).toBe(20); // default
    expect(VisibleTabLimitService.clampLimit(30)).toBe(30); // at ceiling
    expect(VisibleTabLimitService.clampLimit(99)).toBe(30); // above ceiling
    expect(VisibleTabLimitService.clampLimit(10.7)).toBe(11); // rounding
  });
});

// ---------------------------------------------------------------------------
// ADHD-11: reconcile — overflow tabs into Hidden / H:<name> groups
// ---------------------------------------------------------------------------

describe('VisibleTabLimitService — reconcile (ADHD-11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no stored metadata
    mockStorageGet.mockResolvedValue(null);
    mockStorageSet.mockResolvedValue(undefined);
  });

  test('ADHD-11: reconcile() moves overflow tabs into Hidden group without calling chrome.tabs.remove', async () => {
    // Arrange: 25 tabs — 10 pinned, 15 ungrouped unpinned. Limit = 20.
    // Only non-pinned count against limit → 15 unpinned, limit 20 → no overflow.
    // Let's use limit 10 so 5 of the 15 unpinned overflow.
    const limit = 10;
    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    const pinned = Array.from({ length: 10 }, (_, i) => makeTab(i + 1, { pinned: true }));
    const unpinned = Array.from({ length: 15 }, (_, i) =>
      makeTab(i + 11, { lastAccessed: 1_000_000 - i * 1000 }),
    );

    // Tabs 11-20 are the most recently accessed (top 10 stay); tabs 21-25 overflow.
    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === true) return pinned;
      if (query.pinned === false) return unpinned;
      if (query.active === true) return []; // no active tabs in H:* groups
      return [];
    });

    // No existing Hidden group.
    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabGroups.get as jest.Mock).mockRejectedValue(new Error('no group'));

    // chrome.tabs.group → returns groupId 100 (the new shadow group).
    (chrome.tabs.group as jest.Mock).mockResolvedValue(100);

    // chrome.tabGroups.update → resolves.
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue(makeGroup(100, { title: HIDDEN_GROUP_TITLE, collapsed: true }));

    await VisibleTabLimitService.reconcile(1);

    // chrome.tabs.remove must NEVER be called.
    expect(chrome.tabs.remove).not.toHaveBeenCalled();

    // The first overflow tab triggers getOrCreateShadowGroup which calls
    // chrome.tabs.group with the first tab + createProperties.
    const groupCalls = (chrome.tabs.group as jest.Mock).mock.calls;
    expect(groupCalls.length).toBeGreaterThanOrEqual(1);

    // Verify the shadow group was set to collapsed with title 'Hidden'.
    const updateCalls = (chrome.tabGroups.update as jest.Mock).mock.calls;
    const hiddenUpdate = updateCalls.find(
      (args: unknown[]) =>
        typeof (args[1] as { title?: string })?.title === 'string' &&
        (args[1] as { title: string }).title === HIDDEN_GROUP_TITLE,
    );
    expect(hiddenUpdate).toBeDefined();
    const hiddenUpdateProps = hiddenUpdate![1] as { collapsed: boolean };
    expect(hiddenUpdateProps.collapsed).toBe(true);
  });

  test('ADHD-11: pinned tabs are exempt — never demoted into H:*', async () => {
    // 30 tabs: 15 pinned, 15 unpinned. Limit = 10.
    // Expected: all 15 pinned stay, 10 unpinned stay visible, 5 overflow to Hidden.
    const limit = 10;
    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    const pinned = Array.from({ length: 15 }, (_, i) => makeTab(i + 1, { pinned: true }));
    const unpinned = Array.from({ length: 15 }, (_, i) =>
      makeTab(i + 100, { lastAccessed: 1_000_000 - i * 1000 }),
    );

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === true) return pinned;
      if (query.pinned === false) return unpinned;
      if (query.active === true) return [];
      return [];
    });

    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabGroups.get as jest.Mock).mockRejectedValue(new Error('no group'));
    (chrome.tabs.group as jest.Mock).mockResolvedValue(200);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService.reconcile(1);

    // Verify chrome.tabs.remove was never called.
    expect(chrome.tabs.remove).not.toHaveBeenCalled();

    // Verify no pinned tab IDs appear in any chrome.tabs.group call.
    const pinnedIds = new Set(pinned.map((t) => t.id));
    const allGroupedIds = (chrome.tabs.group as jest.Mock).mock.calls
      .flatMap((args: unknown[]) => {
        const arg = args[0] as { tabIds?: number[] };
        return arg.tabIds ?? [];
      });

    for (const id of allGroupedIds) {
      expect(pinnedIds.has(id)).toBe(false);
    }
  });

  test('ADHD-11: reconcile() uses H:<groupName> for grouped overflow tabs', async () => {
    // 5 tabs in group 42 (title: 'Work'), limit = 3 → 2 overflow to H:Work.
    const limit = 3;
    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    const workGroupId = 42;
    const workTabs = Array.from({ length: 5 }, (_, i) =>
      makeTab(i + 1, { groupId: workGroupId, lastAccessed: 1_000_000 - i * 1000 }),
    );

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === true) return [];
      if (query.pinned === false) return workTabs;
      if (query.active === true) return [];
      return [];
    });

    // tabGroups.get(42) returns 'Work' group.
    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === workGroupId) return makeGroup(workGroupId, { title: 'Work', color: 'blue' as chrome.tabGroups.ColorEnum });
      throw new Error(`no group ${id}`);
    });

    // No existing H:Work group.
    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabs.group as jest.Mock).mockResolvedValue(300);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService.reconcile(1);

    // Verify H:Work group was created.
    const updateCalls = (chrome.tabGroups.update as jest.Mock).mock.calls;
    const hWorkUpdate = updateCalls.find(
      (args: unknown[]) => (args[1] as { title?: string })?.title === `${HIDDEN_GROUP_PREFIX}Work`,
    );
    expect(hWorkUpdate).toBeDefined();
    const hWorkProps = hWorkUpdate![1] as { collapsed: boolean; color: string };
    expect(hWorkProps.collapsed).toBe(true);
    expect(hWorkProps.color).toBe('grey');
  });

  test('ADHD-11: manual drag out of H:* evicts oldest-focused from parent when parent overflows', async () => {
    // Work group has `limit` visible tabs; user drags one tab from H:Work into Work.
    // After the move, Work has `limit + 1` tabs → evict oldest 1 to H:Work.
    const limit = 3;
    const draggedTabId = 99;
    const workGroupId = 10;

    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    // After the move, Work group has 4 tabs (limit + 1): dragged + 3 existing.
    // Ordered by lastAccessed desc: tab 99 is newest, tab 1 is oldest.
    const workTabs = [
      makeTab(99, { groupId: workGroupId, lastAccessed: 1_000_000 }), // just dragged — newest
      makeTab(1, { groupId: workGroupId, lastAccessed: 900_000 }),
      makeTab(2, { groupId: workGroupId, lastAccessed: 800_000 }),
      makeTab(3, { groupId: workGroupId, lastAccessed: 700_000 }), // oldest
    ];

    // chrome.tabs.get(draggedTabId) returns tab 99 in the work group.
    (chrome.tabs.get as jest.Mock).mockResolvedValue(workTabs[0]);

    // chrome.tabs.query for the work group returns all 4 tabs.
    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.groupId === workGroupId) return workTabs;
      return [];
    });

    // tabGroups.get(workGroupId) returns 'Work'.
    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === workGroupId) return makeGroup(workGroupId, { title: 'Work' });
      throw new Error(`no group ${id}`);
    });

    // No existing H:Work group.
    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabs.group as jest.Mock).mockResolvedValue(400);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService.onTabManualMoved(draggedTabId, 1);

    // The oldest tab (id=3) should be evicted to H:Work.
    const groupCalls = (chrome.tabs.group as jest.Mock).mock.calls;
    const evictionCall = groupCalls.find((args: unknown[]) => {
      const arg = args[0] as { tabIds?: number[] };
      return arg.tabIds?.includes(3);
    });
    expect(evictionCall).toBeDefined();

    // H:Work shadow group should be created with collapsed: true.
    const updateCalls = (chrome.tabGroups.update as jest.Mock).mock.calls;
    const hWorkUpdate = updateCalls.find(
      (args: unknown[]) => (args[1] as { title?: string })?.title === `${HIDDEN_GROUP_PREFIX}Work`,
    );
    expect(hWorkUpdate).toBeDefined();
    expect((hWorkUpdate![1] as { collapsed: boolean }).collapsed).toBe(true);

    // chrome.tabs.remove must NEVER be called.
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  test('ADHD-11: focus activation is non-displacing when at limit', async () => {
    // Work group has `limit` visible tabs; user clicks a tab inside H:Work.
    // Since count >= limit, no tab should be moved out of H:Work.
    const limit = 3;
    const hWorkGroupId = 50;
    const activatedTabId = 77;

    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    // The activated tab is in H:Work.
    const activatedTab = makeTab(activatedTabId, { groupId: hWorkGroupId });

    (chrome.tabs.get as jest.Mock).mockResolvedValue(activatedTab);

    // tabGroups.get(hWorkGroupId) returns 'H:Work'.
    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === hWorkGroupId) return makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: false });
      throw new Error(`no group ${id}`);
    });

    // The window has `limit` non-pinned non-H:* visible tabs (at the limit).
    const visibleTabs = Array.from({ length: limit }, (_, i) =>
      makeTab(i + 1, { groupId: -1 }), // ungrouped = visible
    );
    const hWorkTab = makeTab(activatedTabId, { groupId: hWorkGroupId });

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === false && !query.groupId && !query.active) {
        return [...visibleTabs, hWorkTab];
      }
      if (query.active === true) return []; // no active tabs in H:*
      return [];
    });

    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([
      makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: false }),
    ]);

    await VisibleTabLimitService.onTabActivated(activatedTabId, 1);

    // At limit: no chrome.tabs.group calls should move the activated tab out.
    // (chrome.tabs.group may still be called for re-collapsing, but no tab
    //  should be ungrouped from H:Work.)
    expect(chrome.tabs.ungroup).not.toHaveBeenCalled();

    // The tab should still be in H:Work (no eviction).
    // chrome.tabs.group would not be called with the activatedTabId being moved out.
    const groupCalls = (chrome.tabs.group as jest.Mock).mock.calls;
    const movedActivated = groupCalls.find((args: unknown[]) => {
      const arg = args[0] as { tabIds?: number[]; groupId?: number };
      return arg.tabIds?.includes(activatedTabId) && arg.groupId !== hWorkGroupId;
    });
    expect(movedActivated).toBeUndefined();
  });

  test('ADHD-11: focus activation below limit DOES move activated tab out of H:*', async () => {
    // Work group has `limit - 1` visible tabs; user clicks a tab in H:Work.
    // Since count < limit, tab should be moved out of H:Work to its parent.
    const limit = 3;
    const hWorkGroupId = 50;
    const workGroupId = 10;
    const activatedTabId = 77;

    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    const activatedTab = makeTab(activatedTabId, { groupId: hWorkGroupId });

    (chrome.tabs.get as jest.Mock).mockResolvedValue(activatedTab);

    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === hWorkGroupId) return makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: true });
      throw new Error(`no group ${id}`);
    });

    // Only limit - 1 non-H:* visible tabs.
    const visibleTabs = Array.from({ length: limit - 1 }, (_, i) =>
      makeTab(i + 1, { groupId: -1 }),
    );
    const hWorkTab = makeTab(activatedTabId, { groupId: hWorkGroupId });

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === false && !query.groupId && !query.active) {
        return [...visibleTabs, hWorkTab];
      }
      if (query.active === true) return [];
      if (query.groupId === hWorkGroupId) return [hWorkTab];
      return [];
    });

    // chrome.tabGroups.query({title: 'Work', windowId: 1}) returns the Work group.
    (chrome.tabGroups.query as jest.Mock).mockImplementation(
      async (query: chrome.tabGroups.QueryInfo) => {
        if (query.title === 'Work') return [makeGroup(workGroupId, { title: 'Work', collapsed: false })];
        if (query.title === 'H:Work') return [makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: true })];
        // windowId-only query for re-collapse.
        return [
          makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: true }),
          makeGroup(workGroupId, { title: 'Work', collapsed: false }),
        ];
      },
    );

    (chrome.tabs.group as jest.Mock).mockResolvedValue(workGroupId);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService.onTabActivated(activatedTabId, 1);

    // The activated tab should be moved to the Work group.
    const groupCalls = (chrome.tabs.group as jest.Mock).mock.calls;
    const moveToWork = groupCalls.find((args: unknown[]) => {
      const arg = args[0] as { tabIds?: number[]; groupId?: number };
      return arg.tabIds?.includes(activatedTabId) && arg.groupId === workGroupId;
    });
    expect(moveToWork).toBeDefined();
  });

  test('ADHD-10 SAFETY boundary: enabled === false short-circuits all operations', async () => {
    mockGetSettings.mockResolvedValue(
      makeSettings({ visibleTabLimit: { enabled: false, limit: 20 } }),
    );

    await VisibleTabLimitService.reconcile(1);

    // No chrome.tabs or chrome.tabGroups calls should have been made.
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.group).not.toHaveBeenCalled();
    expect(chrome.tabGroups.query).not.toHaveBeenCalled();
    expect(chrome.tabGroups.update).not.toHaveBeenCalled();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  test('ADHD-10 SAFETY boundary: masterEnabled === false short-circuits all operations', async () => {
    mockGetSettings.mockResolvedValue({
      ...makeSettings(),
      masterEnabled: false,
    });

    await VisibleTabLimitService.reconcile(1);

    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.group).not.toHaveBeenCalled();
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  test('ADHD-11: getOrCreateShadowGroup reuses existing collapsed group (RESEARCH #5)', async () => {
    const existingGroupId = 77;
    const existingGroup = makeGroup(existingGroupId, {
      title: HIDDEN_GROUP_TITLE,
      collapsed: true,
    });

    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([existingGroup]);
    (chrome.tabs.group as jest.Mock).mockResolvedValue(existingGroupId);

    const result = await VisibleTabLimitService.getOrCreateShadowGroup(
      HIDDEN_GROUP_TITLE,
      1,
      42,
      'grey' as chrome.tabGroups.ColorEnum,
    );

    expect(result).toBe(existingGroupId);
    // Should have reused the group — chrome.tabs.group called to add tab, but
    // chrome.tabGroups.update should NOT be called to set title (already set).
    expect((chrome.tabGroups.update as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as { title?: string })?.title === HIDDEN_GROUP_TITLE,
    )).toBeUndefined();
  });

  test('ADHD-11: getOrCreateShadowGroup creates new group when none exists', async () => {
    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabs.group as jest.Mock).mockResolvedValue(88);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});

    const result = await VisibleTabLimitService.getOrCreateShadowGroup(
      'H:Reading',
      1,
      42,
      'grey' as chrome.tabGroups.ColorEnum,
    );

    expect(result).toBe(88);
    const updateCalls = (chrome.tabGroups.update as jest.Mock).mock.calls;
    const createUpdate = updateCalls.find(
      (args: unknown[]) => (args[1] as { title?: string })?.title === 'H:Reading',
    );
    expect(createUpdate).toBeDefined();
    expect((createUpdate![1] as { collapsed: boolean }).collapsed).toBe(true);
    expect((createUpdate![1] as { color: string }).color).toBe('grey');
  });
});

// ---------------------------------------------------------------------------
// VTL-1: Collapse-on-focus-change — do not collapse H:* while user is inside it
// ---------------------------------------------------------------------------

describe('VisibleTabLimitService — VTL-1 collapse-on-focus-change', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    mockStorageSet.mockResolvedValue(undefined);
  });

  test('VTL-1: reconcile does NOT collapse H:* group whose active tab is inside it', async () => {
    const limit = 5;
    const hWorkGroupId = 99;
    const activeTabId = 55;
    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    // 5 unpinned visible tabs + 2 in H:Work (already there). Active tab is in H:Work.
    const visibleTabs = Array.from({ length: 5 }, (_, i) =>
      makeTab(i + 1, { lastAccessed: 1_000_000 - i * 1000 }),
    );
    const hWorkTabs = [
      makeTab(activeTabId, { groupId: hWorkGroupId, active: true, lastAccessed: 500 }),
      makeTab(56, { groupId: hWorkGroupId, lastAccessed: 400 }),
    ];

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === false && !query.active) return [...visibleTabs, ...hWorkTabs];
      if (query.active === true) return [hWorkTabs[0]]; // active tab is in H:Work
      if (query.groupId === hWorkGroupId) return hWorkTabs;
      return [];
    });

    // All groups in window: H:Work exists
    (chrome.tabGroups.query as jest.Mock).mockImplementation(async (query: chrome.tabGroups.QueryInfo) => {
      if (query.title === HIDDEN_GROUP_TITLE) return [];
      return [makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: false })];
    });
    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === hWorkGroupId) return makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: false });
      throw new Error(`no group ${id}`);
    });

    (chrome.tabs.group as jest.Mock).mockResolvedValue(hWorkGroupId);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService.reconcile(1);

    // H:Work should NOT have been collapsed (active tab is inside it — VTL-1).
    const updateCalls = (chrome.tabGroups.update as jest.Mock).mock.calls;
    const collapseOfHWork = updateCalls.find(
      (args: unknown[]) =>
        args[0] === hWorkGroupId &&
        (args[1] as { collapsed?: boolean })?.collapsed === true,
    );
    expect(collapseOfHWork).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F1: User-expanded H:* groups are never force-collapsed by reconcile
// ---------------------------------------------------------------------------

describe('VisibleTabLimitService — F1 user-expanded group protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    mockStorageSet.mockResolvedValue(undefined);
  });

  test('F1: reconcile does NOT collapse H:* group marked as user-expanded by onHiddenGroupUserExpanded', async () => {
    const limit = 5;
    const hWorkGroupId = 99;
    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    // 5 unpinned visible tabs + 2 in H:Work. No active tab inside H:Work.
    const visibleTabs = Array.from({ length: 5 }, (_, i) =>
      makeTab(i + 1, { lastAccessed: 1_000_000 - i * 1000 }),
    );
    const hWorkTabs = [
      makeTab(55, { groupId: hWorkGroupId, lastAccessed: 500 }),
      makeTab(56, { groupId: hWorkGroupId, lastAccessed: 400 }),
    ];

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === false && !query.active) return [...visibleTabs, ...hWorkTabs];
      if (query.active === true) return []; // no active tab in H:Work
      if (query.groupId === hWorkGroupId) return hWorkTabs;
      return [];
    });

    (chrome.tabGroups.query as jest.Mock).mockImplementation(async () => {
      return [makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: false })];
    });
    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === hWorkGroupId) return makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: false });
      throw new Error(`no group ${id}`);
    });
    (chrome.tabs.group as jest.Mock).mockResolvedValue(hWorkGroupId);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});

    // Simulate user clicking the H:Work group header (Chrome fires tabGroups.onUpdated
    // with collapsed:false). Service-worker calls onHiddenGroupUserExpanded.
    onHiddenGroupUserExpanded(hWorkGroupId);

    // Now reconcile fires (e.g. from another tab event).
    await VisibleTabLimitService.reconcile(1);

    // H:Work must NOT have been collapsed — user expanded it.
    const updateCalls = (chrome.tabGroups.update as jest.Mock).mock.calls;
    const collapseOfHWork = updateCalls.find(
      (args: unknown[]) =>
        args[0] === hWorkGroupId &&
        (args[1] as { collapsed?: boolean })?.collapsed === true,
    );
    expect(collapseOfHWork).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// VTL-2: Original group preservation — graduated tabs return to their home
// ---------------------------------------------------------------------------

describe('VisibleTabLimitService — VTL-2 original group preservation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageSet.mockResolvedValue(undefined);
  });

  test('VTL-2: reconcile stores originalGroup metadata when demoting a tab', async () => {
    const limit = 2;
    const workGroupId = 42;
    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    // 3 tabs in Work group (only 2 visible allowed, 1 overflows)
    const workTabs = [
      makeTab(1, { groupId: workGroupId, lastAccessed: 1_000_000 }),
      makeTab(2, { groupId: workGroupId, lastAccessed: 900_000 }),
      makeTab(3, { groupId: workGroupId, lastAccessed: 800_000 }), // oldest → overflows
    ];

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === false && !query.active) return workTabs;
      if (query.active === true) return [];
      return [];
    });

    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === workGroupId)
        return makeGroup(workGroupId, { title: 'Work', color: 'blue' as chrome.tabGroups.ColorEnum });
      throw new Error(`no group ${id}`);
    });

    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabs.group as jest.Mock).mockResolvedValue(100);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});
    // Storage starts empty
    mockStorageGet.mockResolvedValue(null);

    await VisibleTabLimitService.reconcile(1);

    // Storage.set should have been called to persist metadata for the overflow tab (id=3)
    const setCalls = (mockStorageSet as jest.Mock).mock.calls;
    const metaCalls = setCalls.filter((c: unknown[]) => c[0] === VTL_TAB_METADATA_KEY);
    expect(metaCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('VTL-2: onTabActivated uses metadata to find recreated original group', async () => {
    const limit = 3;
    const hWorkGroupId = 50;
    const activatedTabId = 77;

    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    // Activated tab is in H:Work
    const activatedTab = makeTab(activatedTabId, { groupId: hWorkGroupId });
    (chrome.tabs.get as jest.Mock).mockResolvedValue(activatedTab);

    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === hWorkGroupId)
        return makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: true });
      throw new Error(`no group ${id}`);
    });

    // Only 1 visible tab (below limit of 3)
    const visibleTab = makeTab(1, { groupId: -1 });
    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === false && !query.active && !query.groupId) return [visibleTab];
      if (query.active === true) return [];
      if (query.groupId === hWorkGroupId) return [makeTab(activatedTabId, { groupId: hWorkGroupId })];
      return [];
    });

    // Metadata says original group was 'Work' (blue) — and Work no longer exists
    mockStorageGet.mockResolvedValue({ [activatedTabId]: { originalGroup: { title: 'Work', color: 'blue' } } });

    // tabGroups.query: Work group does not exist
    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([
      makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: true }),
    ]);

    (chrome.tabs.group as jest.Mock).mockResolvedValue(900);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});
    (chrome.tabs.move as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService.onTabActivated(activatedTabId, 1);

    // Since Work group doesn't exist, a NEW group should be created with Work title+color
    const updateCalls = (chrome.tabGroups.update as jest.Mock).mock.calls;
    const workGroupCreate = updateCalls.find(
      (args: unknown[]) => (args[1] as { title?: string })?.title === 'Work',
    );
    expect(workGroupCreate).toBeDefined();
    expect((workGroupCreate![1] as { color: string }).color).toBe('blue');
  });
});

// ---------------------------------------------------------------------------
// VTL-3: Graduated tabs go to END of destination
// ---------------------------------------------------------------------------

describe('VisibleTabLimitService — VTL-3 end-of-destination placement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    mockStorageSet.mockResolvedValue(undefined);
  });

  test('VTL-3: onTabActivated moves graduated tab to end of destination group', async () => {
    const limit = 3;
    const hWorkGroupId = 50;
    const workGroupId = 10;
    const activatedTabId = 77;

    mockGetSettings.mockResolvedValue(makeSettings({ visibleTabLimit: { enabled: true, limit } }));

    const activatedTab = makeTab(activatedTabId, { groupId: hWorkGroupId });
    (chrome.tabs.get as jest.Mock).mockResolvedValue(activatedTab);

    (chrome.tabGroups.get as jest.Mock).mockImplementation(async (id: number) => {
      if (id === hWorkGroupId)
        return makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: true });
      throw new Error(`no group ${id}`);
    });

    // 1 visible tab (below limit)
    const visibleTabs = [makeTab(1, { groupId: -1 })];
    const hWorkTab = makeTab(activatedTabId, { groupId: hWorkGroupId });
    // Work group tabs: makeTab uses id as index by default, so tab 20 has index 20.
    const workGroupTabs = [
      makeTab(20, { groupId: workGroupId }),
      makeTab(21, { groupId: workGroupId }),
      makeTab(22, { groupId: workGroupId }),
    ];

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.pinned === false && !query.active && !query.groupId) return [...visibleTabs, hWorkTab];
      if (query.active === true) return [];
      if (query.groupId === hWorkGroupId) return [hWorkTab];
      if (query.groupId === workGroupId) return workGroupTabs;
      return [];
    });

    // No metadata (falls back to prefix-strip)
    mockStorageGet.mockResolvedValue({});

    (chrome.tabGroups.query as jest.Mock).mockImplementation(
      async (query: chrome.tabGroups.QueryInfo) => {
        if (query.title === 'Work')
          return [makeGroup(workGroupId, { title: 'Work', collapsed: false })];
        return [
          makeGroup(hWorkGroupId, { title: 'H:Work', collapsed: true }),
          makeGroup(workGroupId, { title: 'Work', collapsed: false }),
        ];
      },
    );

    (chrome.tabs.group as jest.Mock).mockResolvedValue(workGroupId);
    (chrome.tabGroups.update as jest.Mock).mockResolvedValue({});
    (chrome.tabs.move as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService.onTabActivated(activatedTabId, 1);

    // chrome.tabs.move should have been called to move tab to end of group (index = max of group tabs)
    const moveCalls = (chrome.tabs.move as jest.Mock).mock.calls;
    const moveCall = moveCalls.find((args: unknown[]) => args[0] === activatedTabId);
    expect(moveCall).toBeDefined();
    // The move should be to index 22 (max of workGroupTabs indices — makeTab uses id as index)
    expect((moveCall![1] as { index: number }).index).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// K-fix: Tab-strip ordering for managed groups
// ---------------------------------------------------------------------------

describe('VisibleTabLimitService — K-fix _orderManagedGroups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    mockStorageSet.mockResolvedValue(undefined);
  });

  test('K-fix: Hidden group is moved to index 0 (leftmost position)', async () => {
    const hiddenGroupId = 10;

    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([
      makeGroup(hiddenGroupId, { title: HIDDEN_GROUP_TITLE }),
    ]);
    (chrome.tabs.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabGroups.move as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService._orderManagedGroups(1);

    // Hidden group must be moved to index 0
    const moveCalls = (chrome.tabGroups.move as jest.Mock).mock.calls;
    const hiddenMove = moveCalls.find(
      (args: unknown[]) => args[0] === hiddenGroupId && (args[1] as { index: number }).index === 0,
    );
    expect(hiddenMove).toBeDefined();
  });

  test('K-fix: H:Work group is moved immediately before its parent Work group', async () => {
    const workGroupId = 20;
    const hWorkGroupId = 30;

    // Work group has first tab at index 5
    const workTabs = [
      makeTab(100, { groupId: workGroupId, windowId: 1 }),
      makeTab(101, { groupId: workGroupId, windowId: 1 }),
    ];
    // override index for test determinism
    workTabs[0] = { ...workTabs[0], index: 5 };
    workTabs[1] = { ...workTabs[1], index: 6 };

    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([
      makeGroup(workGroupId, { title: 'Work' }),
      makeGroup(hWorkGroupId, { title: 'H:Work' }),
    ]);

    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.groupId === workGroupId) return workTabs;
      return [];
    });
    (chrome.tabGroups.move as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService._orderManagedGroups(1);

    // H:Work must be moved to index 5 (parent's first tab index)
    const moveCalls = (chrome.tabGroups.move as jest.Mock).mock.calls;
    const hWorkMove = moveCalls.find(
      (args: unknown[]) =>
        args[0] === hWorkGroupId && (args[1] as { index: number }).index === 5,
    );
    expect(hWorkMove).toBeDefined();
  });

  test('K-fix: H:<name> without parent stays in current position (no move called for it)', async () => {
    const hOrphanGroupId = 40;

    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([
      makeGroup(hOrphanGroupId, { title: 'H:Orphan' }),
      // No parent 'Orphan' group
    ]);
    (chrome.tabs.query as jest.Mock).mockResolvedValue([]);
    (chrome.tabGroups.move as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService._orderManagedGroups(1);

    // No chrome.tabGroups.move should be called for the orphan H:* group
    const moveCalls = (chrome.tabGroups.move as jest.Mock).mock.calls;
    const orphanMove = moveCalls.find((args: unknown[]) => args[0] === hOrphanGroupId);
    expect(orphanMove).toBeUndefined();
  });

  test('K-fix: Hidden is leftmost AND H:Work is adjacent-left of Work when both exist', async () => {
    const hiddenGroupId = 10;
    const workGroupId = 20;
    const hWorkGroupId = 30;

    const workTabs = [{ ...makeTab(100, { groupId: workGroupId }), index: 8 }];

    (chrome.tabGroups.query as jest.Mock).mockResolvedValue([
      makeGroup(hiddenGroupId, { title: HIDDEN_GROUP_TITLE }),
      makeGroup(workGroupId, { title: 'Work' }),
      makeGroup(hWorkGroupId, { title: 'H:Work' }),
    ]);
    (chrome.tabs.query as jest.Mock).mockImplementation(async (query: chrome.tabs.QueryInfo) => {
      if (query.groupId === workGroupId) return workTabs;
      return [];
    });
    (chrome.tabGroups.move as jest.Mock).mockResolvedValue({});

    await VisibleTabLimitService._orderManagedGroups(1);

    const moveCalls = (chrome.tabGroups.move as jest.Mock).mock.calls;

    // Hidden → index 0
    const hiddenMove = moveCalls.find(
      (args: unknown[]) => args[0] === hiddenGroupId && (args[1] as { index: number }).index === 0,
    );
    expect(hiddenMove).toBeDefined();

    // H:Work → index 8 (parent's first tab index)
    const hWorkMove = moveCalls.find(
      (args: unknown[]) => args[0] === hWorkGroupId && (args[1] as { index: number }).index === 8,
    );
    expect(hWorkMove).toBeDefined();
  });
});
