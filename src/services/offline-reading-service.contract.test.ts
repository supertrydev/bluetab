/**
 * @jest-environment node
 *
 * OFFL-02 refined — "never inject into user's existing tabs" contract
 *
 * OfflineReadingService MUST NEVER call chrome.tabs.query() to find
 * already-open user tabs, and MUST NEVER run chrome.scripting.executeScript()
 * against a tabId that was not created by Bluetab itself via chrome.tabs.create.
 *
 * This contract test mirrors Phase 9's auto-suspend-service.safety.test.ts
 * pattern: a static file-level check + a behavioral runtime check.
 *
 * Static check:
 *   Read the service source as text and assert that chrome.tabs.query never
 *   appears as a substring. Zero occurrences required.
 *   Also assert that any chrome.scripting.executeScript occurrence is preceded
 *   within 25 lines by chrome.tabs.create (Wave 2 bg-tab path convention).
 *
 * Behavioral check:
 *   Mock chrome.tabs.query and exercise all OfflineReadingService methods.
 *   The mock must never have been called.
 *
 * See: .planning/phases/10-offline-reading/10-CONTEXT.md §Extraction
 */

import * as fs from 'fs';
import * as path from 'path';

describe('OfflineReadingService OFFL-02 invariant', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, 'offline-reading-service.ts'),
    'utf8',
  );

  it('never calls chrome.tabs.query (file-level static check)', () => {
    expect(src).not.toMatch(/chrome\.tabs\.query\s*\(/);
  });

  it(
    'any chrome.scripting.executeScript occurrence must be preceded within 25 lines by chrome.tabs.create',
    () => {
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (/chrome\.scripting\.executeScript\s*\(/.test(line)) {
          const before = lines.slice(Math.max(0, i - 25), i).join('\n');
          // If executeScript appears, tabs.create must have appeared in the 25 lines above it.
          expect(before).toMatch(/chrome\.tabs\.create\s*\(/);
        }
      });
    },
  );

  it('behavioral: no OfflineReadingService method invokes chrome.tabs.query', async () => {
    const queryMock = jest.fn();
    (global as Record<string, unknown>).chrome = {
      ...((global as Record<string, unknown>).chrome || {}),
      tabs: {
        ...(((global as Record<string, unknown>).chrome as Record<string, unknown>)?.tabs || {}),
        query: queryMock,
        create: jest.fn(),
        remove: jest.fn(),
      },
    };

    // Import after mock install (isolateModules gives a fresh module load)
    jest.isolateModules(() => {
      require('./offline-reading-service');
    });

    // Exercise enqueueExtraction (the only Wave-1 method that might
    // plausibly reach background-tab logic in future edits)
    const { OfflineReadingService } = require('./offline-reading-service') as {
      OfflineReadingService: {
        enqueueExtraction: (tabs: Array<{ groupId: string; tabId: string; url: string }>) => Promise<void>;
      };
    };
    await OfflineReadingService.enqueueExtraction([
      { groupId: 'g', tabId: 't', url: 'https://example.com' },
    ]);

    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('OFFL-02 refined — bg-tab call sites', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, 'offline-reading-service.ts'),
    'utf8',
  );

  it('every chrome.tabs.create call passes active: false', () => {
    // Match every chrome.tabs.create({...}) call site in the source.
    // The regex captures the object literal up to the closing brace.
    const matches = src.match(/chrome\.tabs\.create\s*\(\s*\{[^}]*\}/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    matches.forEach(m => {
      expect(m).toMatch(/active:\s*false/);
    });
  });

  it('behavioral: successful offscreen extraction never invokes chrome.tabs.create', async () => {
    const createMock = jest.fn(async () => ({ id: 999 }));
    (global as Record<string, unknown>).chrome = {
      storage: {
        local: {
          // Stateful mock so queue persists
          _store: { offline_extraction_queue: [] } as Record<string, unknown>,
          get: jest.fn(function(this: { _store: Record<string, unknown> }, key: string) {
            return Promise.resolve({ [key]: this._store[key] ?? [] });
          }),
          set: jest.fn(function(this: { _store: Record<string, unknown> }, obj: Record<string, unknown>) {
            Object.assign(this._store, obj);
            return Promise.resolve();
          }),
        },
      },
      offscreen: {
        hasDocument: jest.fn(async () => false),
        createDocument: jest.fn(async () => {}),
        closeDocument: jest.fn(async () => {}),
      },
      runtime: {
        // Successful result on first offscreen call — bg-tab should NOT be hit
        sendMessage: jest.fn(async () => ({
          success: true,
          title: 'Contract Test Article',
          byline: null,
          contentHtml: '<p>contract test content</p>',
          contentLength: 600,
          wordCount: 250,
          heroBlob: null,
        })),
      },
      tabs: {
        create: createMock,
        remove: jest.fn(async () => {}),
        onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
      },
      scripting: { executeScript: jest.fn() },
    };

    // Fix the `get`/`set` methods to correctly reference the store
    const chromeMock = (global as Record<string, unknown>).chrome as {
      storage: { local: { _store: Record<string, unknown>; get: jest.Mock; set: jest.Mock } };
    };
    const localMock = chromeMock.storage.local;
    localMock.get.mockImplementation(async (key: string) => ({
      [key]: localMock._store[key] ?? [],
    }));
    localMock.set.mockImplementation(async (obj: Record<string, unknown>) => {
      Object.assign(localMock._store, obj);
    });

    const { OfflineReadingService: Svc } = require('./offline-reading-service') as {
      OfflineReadingService: {
        enqueueExtraction: (tabs: Array<{ groupId: string; tabId: string; url: string }>) => Promise<void>;
        saveArticleAtomic: jest.Mock;
      };
    };
    // Spy on saveArticleAtomic to avoid real IDB
    jest.spyOn(Svc, 'saveArticleAtomic').mockResolvedValue(undefined);

    await Svc.enqueueExtraction([
      { groupId: 'g', tabId: 'contract-t', url: 'https://contract.example.com' },
    ]);

    expect(createMock).not.toHaveBeenCalled();
  });
});
