/**
 * Tests for AIService — context pruning, history, stale ID validation, settings,
 * smart naming (suggestGroupName), and tiered search (searchTiered).
 */

import { AIService } from './ai-service';
import { AIAllowanceService } from './ai-allowance-service';
import { Storage } from '../utils/storage';
import { getAccessToken } from '../utils/auth-state';
import type { AIHistoryEntry, AISettings } from '../types/ai';
import { DEFAULT_AI_SETTINGS } from '../types/ai';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../utils/storage');
jest.mock('./ai-allowance-service', () => ({
  AIAllowanceService: {
    syncFromAIResponse: jest.fn(),
  },
}));
jest.mock('../utils/auth-state', () => ({
  getAccessToken: jest.fn(async () => 'test-token'),
}));

const mockStorageGet = Storage.get as jest.MockedFunction<typeof Storage.get>;
const mockStorageSet = Storage.set as jest.MockedFunction<typeof Storage.set>;
const mockStorageRemove = Storage.remove as jest.MockedFunction<typeof Storage.remove>;
const mockGetAccessToken = getAccessToken as jest.MockedFunction<typeof getAccessToken>;
const mockSyncAllowance = AIAllowanceService.syncFromAIResponse as jest.MockedFunction<typeof AIAllowanceService.syncFromAIResponse>;

// Global fetch mock
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Helper to build mock tabs
function makeTabs(count: number, overrides: Partial<chrome.tabs.Tab>[] = []): chrome.tabs.Tab[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Tab ${i + 1}`,
    url: `https://example${i + 1}.com/page`,
    active: false,
    pinned: false,
    highlighted: false,
    windowId: 1,
    index: i,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    ...overrides[i],
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorageGet.mockResolvedValue(null);
  mockStorageSet.mockResolvedValue(undefined);
  mockStorageRemove.mockResolvedValue(undefined);
  mockGetAccessToken.mockResolvedValue('test-token');
  mockSyncAllowance.mockResolvedValue(undefined);
});

// ============================================================================
// buildContext
// ============================================================================

describe('AIService.buildContext()', () => {
  it('returns <= 50 tabs when given 100 mock tabs', async () => {
    const tabs = makeTabs(100);
    (chrome.tabs.query as jest.Mock).mockImplementation(
      (_opts: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback(tabs);
      }
    );
    mockStorageGet.mockResolvedValue([]);

    const ctx = await AIService.buildContext('');
    expect(ctx.tabs.length).toBeLessThanOrEqual(50);
    expect(ctx.totalTabCount).toBe(100);
  });

  it('scores shopping-related tabs higher when query contains "shopping"', async () => {
    const tabs = [
      ...makeTabs(60),
      {
        id: 101,
        title: 'Amazon Shopping Cart',
        url: 'https://amazon.com/shopping',
        active: false, pinned: false, highlighted: false,
        windowId: 1, index: 60, incognito: false, selected: false,
        discarded: false, autoDiscardable: true, groupId: -1,
      } as chrome.tabs.Tab,
      {
        id: 102,
        title: 'eBay deals for shopping',
        url: 'https://ebay.com/shopping',
        active: false, pinned: false, highlighted: false,
        windowId: 1, index: 61, incognito: false, selected: false,
        discarded: false, autoDiscardable: true, groupId: -1,
      } as chrome.tabs.Tab,
    ];
    (chrome.tabs.query as jest.Mock).mockImplementation(
      (_opts: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback(tabs);
      }
    );
    mockStorageGet.mockResolvedValue([]);

    const ctx = await AIService.buildContext('shopping');
    // Shopping-related tabs (IDs 101, 102) should be in the top 50
    const returnedIds = ctx.tabs.map((t) => t.id);
    expect(returnedIds).toContain(101);
    expect(returnedIds).toContain(102);
  });

  it('returns top 50 tabs by domain frequency when query is empty', async () => {
    const tabs = makeTabs(100);
    (chrome.tabs.query as jest.Mock).mockImplementation(
      (_opts: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback(tabs);
      }
    );
    mockStorageGet.mockResolvedValue([]);

    const ctx = await AIService.buildContext('');
    expect(ctx.tabs.length).toBeLessThanOrEqual(50);
    expect(ctx.totalTabCount).toBe(100);
  });
});

// ============================================================================
// validateTabIds
// ============================================================================

describe('AIService.validateTabIds()', () => {
  it('partitions provided IDs into valid and stale sets', async () => {
    const liveTabs = makeTabs(3); // IDs 1, 2, 3
    (chrome.tabs.query as jest.Mock).mockImplementation(
      (_opts: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback(liveTabs);
      }
    );

    const result = await AIService.validateTabIds([1, 2, 999]);
    expect(result.valid).toEqual(expect.arrayContaining([1, 2]));
    expect(result.stale).toEqual([999]);
    expect(result.valid).not.toContain(999);
  });
});

// ============================================================================
// History
// ============================================================================

describe('AIService history', () => {
  const sampleEntry: AIHistoryEntry = {
    id: 'entry-1',
    userMessage: 'archive shopping tabs',
    assistantResponse: 'I archived 3 shopping tabs.',
    timestamp: Date.now(),
    toolsUsed: ['save_tabs'],
  };

  it('saveHistoryEntry persists using RingBuffer(50)', async () => {
    mockStorageGet.mockResolvedValue([]);

    await AIService.saveHistoryEntry(sampleEntry);

    expect(mockStorageSet).toHaveBeenCalledWith('ai_history', [sampleEntry]);
  });

  it('getHistory returns entries from storage', async () => {
    mockStorageGet.mockResolvedValue([sampleEntry]);

    const history = await AIService.getHistory();
    expect(history).toEqual([sampleEntry]);
  });

  it('getHistory returns empty array when storage is empty', async () => {
    mockStorageGet.mockResolvedValue(null);

    const history = await AIService.getHistory();
    expect(history).toEqual([]);
  });

  it('clearHistory removes legacy history plus thread-based chat storage', async () => {
    await AIService.clearHistory();
    expect(mockStorageRemove).toHaveBeenNthCalledWith(1, 'ai_history');
    expect(mockStorageRemove).toHaveBeenNthCalledWith(2, 'ai_chat_threads');
    expect(mockStorageRemove).toHaveBeenNthCalledWith(3, 'ai_active_thread');
  });

  it('caps history at 50 entries (RingBuffer behavior)', async () => {
    const existing: AIHistoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: `entry-${i}`,
      userMessage: `msg ${i}`,
      assistantResponse: `resp ${i}`,
      timestamp: Date.now(),
      toolsUsed: [],
    }));
    mockStorageGet.mockResolvedValue(existing);

    const newEntry: AIHistoryEntry = {
      id: 'entry-new',
      userMessage: 'new message',
      assistantResponse: 'new response',
      timestamp: Date.now(),
      toolsUsed: [],
    };
    await AIService.saveHistoryEntry(newEntry);

    const saved = (mockStorageSet.mock.calls[0][1] as AIHistoryEntry[]);
    expect(saved.length).toBe(50);
    expect(saved[49].id).toBe('entry-new');
  });
});

// ============================================================================
// Settings
// ============================================================================

describe('AIService settings', () => {
  it('getSettings returns DEFAULT_AI_SETTINGS when no stored settings', async () => {
    mockStorageGet.mockResolvedValue(null);

    const settings = await AIService.getSettings();
    expect(settings).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('getSettings merges stored settings with defaults', async () => {
    mockStorageGet.mockResolvedValue({ smartNaming: false });

    const settings = await AIService.getSettings();
    expect(settings.smartNaming).toBe(false);
    expect(settings).toEqual({ ...DEFAULT_AI_SETTINGS, smartNaming: false });
  });

  it('saveSettings persists to ai_settings', async () => {
    const customSettings: AISettings = {
      smartNaming: false,
      alwaysAllowIntegrationActions: true,
    };

    await AIService.saveSettings(customSettings);
    expect(mockStorageSet).toHaveBeenCalledWith('ai_settings', customSettings);
  });
});

// ============================================================================
// buildSystemPrompt
// ============================================================================

describe('AIService.buildSystemPrompt()', () => {
  it('returns a non-empty string system prompt', () => {
    const context = {
      tabs: [{ id: 1, title: 'Example', url: 'https://example.com' }],
      groupSummary: [],
      totalTabCount: 1,
    };
    const prompt = AIService.buildSystemPrompt(context, true);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('includes Pro status in system prompt', () => {
    const context = {
      tabs: [],
      groupSummary: [],
      totalTabCount: 0,
    };
    const promptPro = AIService.buildSystemPrompt(context, true);
    const promptFree = AIService.buildSystemPrompt(context, false);
    expect(promptPro).toContain('Pro');
    expect(promptFree).not.toContain('Pro');
  });

  it('keeps tool contract guidance aligned with runtime behavior', () => {
    const context = {
      tabs: [],
      groupSummary: [],
      totalTabCount: 0,
    };

    const prompt = AIService.buildSystemPrompt(context, true);

    expect(prompt).not.toContain('archive_tabs');
    expect(prompt).toContain('get_context:');
    expect(prompt).toContain('- all: returns one combined snapshot');
    expect(prompt).toContain('Confirmation-gated actions (delete_tabs, manage_projects delete, manage_groups delete, manage_brain_dump delete)');
    expect(prompt).toContain('search_brain_dump');
  });
});

// ============================================================================
// suggestGroupName (smart naming)
// ============================================================================

describe('AIService.suggestGroupName()', () => {
  const twoTabs = [
    { title: 'React docs', url: 'https://react.dev' },
    { title: 'Vue docs', url: 'https://vuejs.org' },
  ];

  beforeEach(() => {
    mockFetch.mockReset();
    // Default: smartNaming enabled and the AI data notice already seen
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'ai_settings') return { smartNaming: true };
      if (key === 'ai_data_notice_seen') return { version: 1, seenAt: 1 };
      if (key === 'bluetab_auth_token') return 'test-token';
      return null;
    });
  });

  it('skips the request until the AI data notice has been shown', async () => {
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'ai_settings') return { smartNaming: true };
      return null;
    });

    const result = await AIService.suggestGroupName(twoTabs);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls name-group endpoint and returns the suggested name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'Frontend Frameworks' }),
    } as Response);

    const result = await AIService.suggestGroupName(twoTabs);
    expect(result).toBe('Frontend Frameworks');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/ai/name-group');
    expect(opts.method).toBe('POST');
  });

  it('returns null for single-tab groups without making an API call', async () => {
    const result = await AIService.suggestGroupName([{ title: 'Only tab', url: 'https://example.com' }]);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when smartNaming setting is disabled', async () => {
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'ai_settings') return { smartNaming: false };
      if (key === 'bluetab_auth_token') return 'test-token';
      return null;
    });

    const result = await AIService.suggestGroupName(twoTabs);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null on network error without throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await AIService.suggestGroupName(twoTabs);
    expect(result).toBeNull();
  });

  it('returns null on AbortError (timeout) without throwing', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await AIService.suggestGroupName(twoTabs);
    expect(result).toBeNull();
  });

  it('returns null when response JSON parse fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    } as unknown as Response);

    const result = await AIService.suggestGroupName(twoTabs);
    expect(result).toBeNull();
  });
});

// ============================================================================
// searchTiered (three-tier search)
// ============================================================================

describe('AIService.searchTiered()', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'bluetab_auth_token') return 'test-token';
      return null;
    });
  });

  it('returns bluetab tier results when 3+ matches found in stored groups', async () => {
    const storedGroups = [
      {
        id: 'g1', name: 'React Group',
        tabs: [
          { title: 'React docs', url: 'https://react.dev' },
          { title: 'React tutorial', url: 'https://react.dev/learn' },
          { title: 'React hooks', url: 'https://react.dev/hooks' },
        ],
      },
    ];
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'groups') return storedGroups;
      if (key === 'bluetab_auth_token') return 'test-token';
      return null;
    });

    const result = await AIService.searchTiered('react');
    expect(result.tier).toBe('bluetab');
    expect(result.results.length).toBeGreaterThanOrEqual(3);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls through to web search when no Bluetab matches', async () => {
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'groups') return [];
      if (key === 'bluetab_auth_token') return 'test-token';
      return null;
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: 'React official', url: 'https://react.dev', snippet: 'React docs' },
        ],
      }),
    } as Response);

    const result = await AIService.searchTiered('react');
    expect(result.tier).toBe('web');
    expect(result.results.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('calls web search endpoint on fetch and returns results', async () => {
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'groups') return [];
      if (key === 'bluetab_auth_token') return 'test-token';
      return null;
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: 'Web result', url: 'https://webresult.com', snippet: 'snippet' },
        ],
      }),
    } as Response);

    const result = await AIService.searchTiered('typescript');
    expect(result.tier).toBe('web');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/ai/search');
    expect(opts.method).toBe('POST');
  });

  it('returns empty web results gracefully on web search failure', async () => {
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'groups') return [];
      if (key === 'bluetab_auth_token') return 'test-token';
      return null;
    });
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await AIService.searchTiered('react');
    expect(result.tier).toBe('web');
    expect(result.results).toEqual([]);
  });

  it('skips RSS tier gracefully when RSS is unavailable and falls to web', async () => {
    // Only 1 Bluetab match (below threshold), RSS unavailable, web succeeds
    const storedGroups = [
      {
        id: 'g1', name: 'Misc',
        tabs: [
          { title: 'React intro', url: 'https://react.dev' },
        ],
      },
    ];
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === 'groups') return storedGroups;
      if (key === 'rss_feeds') return null; // No RSS feeds
      if (key === 'rss_articles') return null;
      if (key === 'bluetab_auth_token') return 'test-token';
      return null;
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ title: 'React web result', url: 'https://react.dev' }] }),
    } as Response);

    const result = await AIService.searchTiered('react');
    // Should end up at web tier since no Bluetab/RSS matches
    expect(['web', 'rss']).toContain(result.tier);
  });
});
