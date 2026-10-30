/**
 * Jest Global Setup
 *
 * WHY:  Chrome extension APIs are not available in Node.js (Jest's test environment).
 *       Tests that call chrome.storage.local.* or chrome.alarms.* would throw
 *       "chrome is not defined" without this setup.
 *
 * WHAT: Provides a global `chrome` mock object covering storage.local (including
 *       getBytesInUse), storage.session, alarms, runtime, and Phase 2 APIs
 *       (notifications, action badge, tabs, windows, tabGroups, contextMenus).
 *
 * HOW:  Runs via jest setupFilesAfterEnv — executes after the test framework is
 *       installed but before any test files run.
 *
 * NOT:  Does not provide behavioral mocks — each test must configure return
 *       values via jest.fn().mockResolvedValue() as needed.
 */

// Global chrome mock for Jest (Node environment)
(global as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
      getBytesInUse: jest.fn(),
    },
    session: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(),
    },
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn(),
    onAlarm: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(),
    },
  },
  runtime: {
    lastError: undefined,
    id: 'test-extension-id',
    getURL: jest.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
    // Phase 9 — favicon-overlay handshake.
    //
    // AutoSuspendService.suspend() subscribes to onMessage for a single
    // 'bluetab:favicon-overlay-ready' message (sent by the favicon-overlay
    // content script once it finishes the composite canvas pipeline) and
    // waits up to OVERLAY_READY_TIMEOUT_MS before discarding. To keep
    // tests fast and the ordering assertions clean, the onMessage mock
    // captures the registered listener so tests can dispatch synthetic
    // handshakes synchronously.
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(),
    },
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
  i18n: {
    getUILanguage: jest.fn(() => 'en-US'),
  },

  // Phase 2 — Notifications
  notifications: {
    create: jest.fn(),
    clear: jest.fn(),
    onButtonClicked: {
      addListener: jest.fn(),
    },
    onClicked: {
      addListener: jest.fn(),
    },
  },

  // Phase 2 — Extension badge (action)
  // setIcon added in Phase 9 foundations execution — Phase 8 teams-service
  // calls it at module load time via updateBadge(); tests that transitively
  // import teams-service crashed without this mock. Additive only (per
  // Plan 09-01 interfaces guidance: missing mocks may be extended here).
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
    setIcon: jest.fn().mockResolvedValue(undefined),
  },

  // Phase 2 — Tabs
  // Phase 9 additions (auto-suspend-service.safety.test.ts contract):
  //   - update / discard: suspend() pipeline + SAFETY-01 "no branded navigation" assertion
  //   - get: suspend() fetches title/url/favicon for SuspendedSessionCache before discard
  //   - onActivated: activity tracker — per-tab lastActive timestamp
  tabs: {
    query: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    group: jest.fn(),
    move: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    discard: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    ungroup: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    // Phase 8 — Teams tab event listeners
    onCreated: { addListener: jest.fn(), removeListener: jest.fn() },
    onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
    onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    onActivated: { addListener: jest.fn(), removeListener: jest.fn() },
  },

  // Phase 2 — Windows
  windows: {
    getAll: jest.fn(),
    create: jest.fn(),
  },

  // Phase 2 — Tab Groups
  // Phase 9: tabGroups.remove added as defensive SAFETY-01 contract assertion
  // (auto-suspend-service must NEVER call it — see 09-RESEARCH Open Question #5).
  // Phase 12: tabGroups.get added for VisibleTabLimitService._getGroupTitle().
  // K-fix: tabGroups.move added for _orderManagedGroups (tab-strip ordering).
  tabGroups: {
    query: jest.fn(),
    update: jest.fn(),
    get: jest.fn(),
    move: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
  },

  // Phase 9 — chrome.scripting (auto-suspend favicon overlay injection)
  scripting: {
    executeScript: jest.fn().mockResolvedValue(undefined),
    registerContentScripts: jest.fn().mockResolvedValue(undefined),
    unregisterContentScripts: jest.fn().mockResolvedValue(undefined),
    getRegisteredContentScripts: jest.fn().mockResolvedValue([]),
  },

  permissions: {
    contains: jest.fn().mockResolvedValue(false),
    request: jest.fn().mockResolvedValue(false),
  },

  // Phase 2 — Context Menus
  contextMenus: {
    create: jest.fn(),
  },

  // Phase 6 — declarativeNetRequest (Focus Mode)
  declarativeNetRequest: {
    updateDynamicRules: jest.fn().mockResolvedValue(undefined),
    getDynamicRules: jest.fn().mockResolvedValue([]),
    RuleActionType: { REDIRECT: 'redirect' },
    ResourceType: { MAIN_FRAME: 'main_frame' },
  },
};

// Phase 8 — WebSocket mock for Teams
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;
  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send = jest.fn();
  close = jest.fn();
  constructor(url: string) { this.url = url; }
}
(global as Record<string, unknown>).WebSocket = MockWebSocket;
