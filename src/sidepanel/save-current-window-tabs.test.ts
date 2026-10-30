import { Storage } from '../utils/storage';
import { getAuthState } from '../utils/auth-state';
import { saveTabsToBlueTab } from '../services/saved-tab-actions';
import {
  saveBrowserTabsSelection,
  saveCurrentWindowTabs,
  saveSuspendedTabsFromCurrentWindow,
} from '../services/save-current-window-tabs';
import { saveCurrentWindowTabsFromSidepanel } from './save-current-window-tabs';

jest.mock('../utils/storage', () => ({
  Storage: {
    getSettings: jest.fn(),
  },
}));

jest.mock('../utils/auth-state', () => ({
  getAuthState: jest.fn(),
}));

jest.mock('../services/saved-tab-actions', () => ({
  saveTabsToBlueTab: jest.fn(),
}));

const mockGetSettings = Storage.getSettings as jest.MockedFunction<typeof Storage.getSettings>;
const mockGetAuthState = getAuthState as jest.MockedFunction<typeof getAuthState>;
const mockSaveTabsToBlueTab = saveTabsToBlueTab as jest.MockedFunction<typeof saveTabsToBlueTab>;
const mockTabsQuery = chrome.tabs.query as jest.Mock;
const mockTabsCreate = chrome.tabs.create as jest.Mock;

function makeChromeTab(overrides: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    pinned: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: 'https://example.com',
    title: 'Example',
    ...overrides,
  } as chrome.tabs.Tab;
}

describe('saveCurrentWindowTabsFromSidepanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({ browserTabsCloseOnSave: true } as never);
    mockGetAuthState.mockResolvedValue({
      isLoggedIn: true,
      isLoading: false,
      user: null,
      subscription: null,
      isPro: true,
      lastChecked: 0,
      offlineSince: null,
    } as never);
    mockSaveTabsToBlueTab.mockResolvedValue({
      processedCount: 2,
      memoryRestoredCount: 1,
      flowMatchedCount: 1,
      defaultGroupedCount: 0,
      closedCount: 2,
      savedGroups: [],
    });
    mockTabsQuery.mockResolvedValue([
      { id: 1, url: 'https://x.com', title: 'X', pinned: false },
      { id: 2, url: 'https://github.com', title: 'GitHub', pinned: false },
    ]);
    mockTabsCreate.mockResolvedValue({ id: 99 });
  });

  it('routes sidepanel Save Current Tabs through saveTabsToBlueTab with close-on-save and Pro naming context', async () => {
    await saveCurrentWindowTabsFromSidepanel({ now: 1_700_000_000_000 });

    expect(mockSaveTabsToBlueTab).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, url: 'https://x.com' }),
        expect.objectContaining({ id: 2, url: 'https://github.com' }),
      ]),
      expect.stringMatching(/^Session /),
      expect.objectContaining({
        closeSourceTabs: true,
        isPro: true,
        now: 1_700_000_000_000,
      }),
    );
  });

  it('opens the manager tab before closing when all savable tabs in the window would be removed', async () => {
    await saveCurrentWindowTabsFromSidepanel({ now: 1_700_000_000_000 });

    expect(mockTabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/src/options/index.html',
    });
  });

  it('respects the close-on-save setting when disabled', async () => {
    mockGetSettings.mockResolvedValue({ browserTabsCloseOnSave: false } as never);

    await saveCurrentWindowTabsFromSidepanel({ now: 1_700_000_000_000 });

    expect(mockSaveTabsToBlueTab).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({
        closeSourceTabs: false,
      }),
    );
    expect(mockTabsCreate).not.toHaveBeenCalled();
  });
});

describe('saveBrowserTabsSelection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({ browserTabsCloseOnSave: true } as never);
    mockGetAuthState.mockResolvedValue({
      isLoggedIn: true,
      isLoading: false,
      user: null,
      subscription: null,
      isPro: true,
      lastChecked: 0,
      offlineSince: null,
    } as never);
    mockSaveTabsToBlueTab.mockResolvedValue({
      processedCount: 1,
      memoryRestoredCount: 0,
      flowMatchedCount: 1,
      defaultGroupedCount: 0,
      closedCount: 1,
      savedGroups: [],
    });
    mockTabsCreate.mockResolvedValue({ id: 99 });
  });

  it('routes an arbitrary tab selection through saveTabsToBlueTab with the provided group name', async () => {
    await saveBrowserTabsSelection({
      tabs: [makeChromeTab({ id: 7, url: 'https://example.com', title: 'Example', pinned: false })],
      defaultGroupName: 'Single Tab: Example',
      now: 1_700_000_000_000,
      currentWindowTabs: [
        makeChromeTab({ id: 7, url: 'https://example.com', title: 'Example', pinned: false }),
      ],
    });

    expect(mockSaveTabsToBlueTab).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 7, url: 'https://example.com' }),
      ]),
      'Single Tab: Example',
      expect.objectContaining({
        closeSourceTabs: true,
        isPro: true,
        now: 1_700_000_000_000,
      }),
    );
  });

  it('uses the current window tabs to guard against closing the final browser tab', async () => {
    await saveBrowserTabsSelection({
      tabs: [makeChromeTab({ id: 3, url: 'https://only-tab.com', title: 'Only', pinned: false })],
      defaultGroupName: 'Single Tab: Only',
      now: 1_700_000_000_000,
      currentWindowTabs: [
        makeChromeTab({ id: 3, url: 'https://only-tab.com', title: 'Only', pinned: false }),
      ],
    });

    expect(mockTabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/src/options/index.html',
    });
  });
});

describe('saveCurrentWindowTabs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({ browserTabsCloseOnSave: true } as never);
    mockGetAuthState.mockResolvedValue({
      isLoggedIn: true,
      isLoading: false,
      user: null,
      subscription: null,
      isPro: true,
      lastChecked: 0,
      offlineSince: null,
    } as never);
    mockSaveTabsToBlueTab.mockResolvedValue({
      processedCount: 2,
      memoryRestoredCount: 1,
      flowMatchedCount: 1,
      defaultGroupedCount: 0,
      closedCount: 2,
      savedGroups: [],
    });
    mockTabsQuery.mockResolvedValue([
      { id: 1, url: 'https://x.com', title: 'X', pinned: false },
      { id: 2, url: 'https://github.com', title: 'GitHub', pinned: false },
    ]);
    mockTabsCreate.mockResolvedValue({ id: 99 });
  });

  it('queries the current window and then delegates through the shared selection helper', async () => {
    await saveCurrentWindowTabs({ now: 1_700_000_000_000 });

    expect(mockTabsQuery).toHaveBeenCalledWith({ currentWindow: true });
    expect(mockSaveTabsToBlueTab).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, url: 'https://x.com' }),
        expect.objectContaining({ id: 2, url: 'https://github.com' }),
      ]),
      expect.stringMatching(/^Session /),
      expect.objectContaining({
        closeSourceTabs: true,
        isPro: true,
        now: 1_700_000_000_000,
      }),
    );
  });
});

describe('saveSuspendedTabsFromCurrentWindow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({ browserTabsCloseOnSave: true } as never);
    mockGetAuthState.mockResolvedValue({
      isLoggedIn: true,
      isLoading: false,
      user: null,
      subscription: null,
      isPro: true,
      lastChecked: 0,
      offlineSince: null,
    } as never);
    mockSaveTabsToBlueTab.mockResolvedValue({
      processedCount: 1,
      memoryRestoredCount: 0,
      flowMatchedCount: 1,
      defaultGroupedCount: 0,
      closedCount: 1,
      savedGroups: [],
    });
    mockTabsCreate.mockResolvedValue({ id: 99 });
  });

  it('filters to discarded tabs and routes them through the shared save pipeline', async () => {
    mockTabsQuery.mockResolvedValue([
      makeChromeTab({ id: 1, url: 'https://awake.com', title: 'Awake', discarded: false }),
      makeChromeTab({ id: 2, url: 'https://sleepy.com', title: 'Sleepy', discarded: true }),
      makeChromeTab({ id: 3, url: 'https://nap.com', title: 'Nap', discarded: true }),
    ]);

    await saveSuspendedTabsFromCurrentWindow({ now: 1_700_000_000_000 });

    expect(mockSaveTabsToBlueTab).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 2, url: 'https://sleepy.com', discarded: true }),
        expect.objectContaining({ id: 3, url: 'https://nap.com', discarded: true }),
      ]),
      expect.stringMatching(/^Suspended /),
      expect.objectContaining({
        closeSourceTabs: true,
        isPro: true,
        now: 1_700_000_000_000,
      }),
    );
    expect(mockSaveTabsToBlueTab.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('returns null when there are no suspended tabs to save', async () => {
    mockTabsQuery.mockResolvedValue([
      makeChromeTab({ id: 1, url: 'https://awake.com', title: 'Awake', discarded: false }),
    ]);

    const result = await saveSuspendedTabsFromCurrentWindow({ now: 1_700_000_000_000 });

    expect(result).toBeNull();
    expect(mockSaveTabsToBlueTab).not.toHaveBeenCalled();
  });
});
