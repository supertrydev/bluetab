/**
 * Jest Global Setup
 *
 * WHY:  Chrome extension APIs are not available in Node.js (Jest's test environment).
 *       Tests that call chrome.storage.local.* or chrome.alarms.* would throw
 *       "chrome is not defined" without this setup.
 *
 * WHAT: Provides a global `chrome` mock object covering storage.local (including
 *       getBytesInUse), storage.session, alarms, and runtime.
 *
 * HOW:  Runs via jest setupFilesAfterEnv — executes after the test framework is
 *       installed but before any test files run.
 *
 * NOT:  Does not mock chrome.tabs, chrome.windows, or other extension APIs
 *       not needed for Phase 1 utility tests.
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
  },
};
