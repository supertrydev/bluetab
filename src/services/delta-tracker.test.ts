/**
 * Tests for delta-tracker.ts
 *
 * Covers delta generation, sync echo suppression, and privacy requirements
 * that ensure AI storage keys are NEVER synced.
 */

import {
  processStorageChange,
  onDeltasGenerated,
  registerExpectedSyncWrite,
  isSyncCurrentlyApplying,
  setSyncApplying,
  isSyncableKey,
  isArrayKey,
  isObjectKey,
  deepEqual,
} from './delta-tracker';
import type { GeneratedDelta } from './delta-tracker';
import { SYNCABLE_KEYS } from '@/types/sync';
import { BRAIN_DUMP_INBOX_KEY, type BrainDumpEntry } from '@/types/adhd';

// Mock sync-crypto since it's not needed for delta-tracker unit tests
jest.mock('./sync-crypto', () => ({
  encryptDelta: jest.fn().mockResolvedValue({ encryptedData: 'enc', iv: 'iv' }),
}));

// ============================================================================
// Phase 9 — adhd_settings sync-key registration (ADHD-03)
// ============================================================================

describe('Sync: adhd_settings is registered as a syncable object key (ADHD-03)', () => {
  it('SYNCABLE_KEYS includes adhd_settings', () => {
    expect(SYNCABLE_KEYS).toContain('adhd_settings');
  });

  it('adhd_settings is classified as an object key (field-level diff)', () => {
    expect(isObjectKey('adhd_settings')).toBe(true);
    expect(isArrayKey('adhd_settings')).toBe(false);
  });
});

// ============================================================================
// Brain Dump sync registration
// ============================================================================

describe('Sync: Brain Dump inbox is registered as a syncable array key', () => {
  const entry = {
    id: 'dump-1',
    text: 'Follow up on MCP sync health',
    createdAt: 1,
    tabContext: {
      url: 'https://example.com/context',
      title: 'Context',
    },
  } satisfies BrainDumpEntry;

  it('SYNCABLE_KEYS includes the Brain Dump inbox key', () => {
    expect(SYNCABLE_KEYS).toContain(BRAIN_DUMP_INBOX_KEY);
  });

  it('brain_dump_inbox is classified as an array key for entity-level deltas', () => {
    expect(isArrayKey(BRAIN_DUMP_INBOX_KEY)).toBe(true);
    expect(isObjectKey(BRAIN_DUMP_INBOX_KEY)).toBe(false);
  });

  it('generates add, update, and delete deltas for Brain Dump entries', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    processStorageChange(
      {
        [BRAIN_DUMP_INBOX_KEY]: {
          oldValue: [],
          newValue: [entry],
        },
      },
      'local'
    );

    const edited = { ...entry, text: 'Edited note', updatedAt: 2 } satisfies BrainDumpEntry;
    processStorageChange(
      {
        [BRAIN_DUMP_INBOX_KEY]: {
          oldValue: [entry],
          newValue: [edited],
        },
      },
      'local'
    );

    processStorageChange(
      {
        [BRAIN_DUMP_INBOX_KEY]: {
          oldValue: [edited],
          newValue: [],
        },
      },
      'local'
    );

    expect(deltas.map((delta) => delta.storageKey)).toEqual([
      BRAIN_DUMP_INBOX_KEY,
      BRAIN_DUMP_INBOX_KEY,
      BRAIN_DUMP_INBOX_KEY,
    ]);
    expect(deltas.map((delta) => delta.entityOp)).toEqual(['add', 'update', 'delete']);
    expect(deltas.map((delta) => delta.entityId)).toEqual(['dump-1', 'dump-1', 'dump-1']);

    unsubscribe();
  });
});

// ============================================================================
// Settings sync coverage
// ============================================================================

describe('Sync: user-facing settings keys are registered as object keys', () => {
  const syncedSettingsKeys = [
    'bluetab_text_size_settings',
    'pomodoroSettings',
    'focusSettings',
    'brain_dump_prefs',
    'ai_settings',
    'reminderSettings',
    'rssSettings',
    'backupSettings',
  ] as const;

  it('includes the requested settings keys in SYNCABLE_KEYS', () => {
    for (const key of syncedSettingsKeys) {
      expect(SYNCABLE_KEYS).toContain(key);
      expect(isSyncableKey(key)).toBe(true);
      expect(isObjectKey(key)).toBe(true);
      expect(isArrayKey(key)).toBe(false);
    }
  });

  it('generates field-level deltas for newly synced settings keys', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    processStorageChange(
      {
        focusSettings: {
          oldValue: { enabled: false, customDomains: [] },
          newValue: { enabled: true, customDomains: ['example.com'] },
        },
      },
      'local'
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0].storageKey).toBe('focusSettings');
    expect(deltas[0].payload).toEqual({
      data: { enabled: true, customDomains: ['example.com'] },
    });

    unsubscribe();
  });
});

describe('Privacy: AI history remains device-local', () => {
  it('should NOT include ai_history in syncable keys', () => {
    expect(isSyncableKey('ai_history')).toBe(false);
  });
});

describe('Sync: reminders are registered as an array key', () => {
  it('tracks reminder records with entity-level deltas', () => {
    expect(SYNCABLE_KEYS).toContain('reminders');
    expect(isArrayKey('reminders')).toBe(true);
    expect(isObjectKey('reminders')).toBe(false);
  });
});

// ============================================================================
// Delta generation — array keys
// ============================================================================

describe('processStorageChange — array keys', () => {
  it('generates an add delta when a new entity appears', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    processStorageChange(
      {
        groups: {
          oldValue: [],
          newValue: [{ id: 'g1', name: 'Group 1', modified: 1 }],
        },
      },
      'local'
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0].storageKey).toBe('groups');
    expect(deltas[0].entityOp).toBe('add');
    expect(deltas[0].entityId).toBe('g1');

    unsubscribe();
  });

  it('generates a delete delta when an entity disappears', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    processStorageChange(
      {
        groups: {
          oldValue: [{ id: 'g1', name: 'Group 1', modified: 1 }],
          newValue: [],
        },
      },
      'local'
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0].entityOp).toBe('delete');
    expect(deltas[0].entityId).toBe('g1');

    unsubscribe();
  });

  it('generates an update delta when an entity changes', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    processStorageChange(
      {
        groups: {
          oldValue: [{ id: 'g1', name: 'Group 1', modified: 1 }],
          newValue: [{ id: 'g1', name: 'Updated Group', modified: 2 }],
        },
      },
      'local'
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0].entityOp).toBe('update');

    unsubscribe();
  });

  it('generates no deltas when nothing changes', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    processStorageChange(
      {
        groups: {
          oldValue: [{ id: 'g1', name: 'Group 1', modified: 1 }],
          newValue: [{ id: 'g1', name: 'Group 1', modified: 1 }],
        },
      },
      'local'
    );

    expect(deltas).toHaveLength(0);

    unsubscribe();
  });
});

// ============================================================================
// Delta generation — object keys
// ============================================================================

describe('processStorageChange — object keys', () => {
  it('generates a delta when settings change', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    processStorageChange(
      {
        settings: {
          oldValue: { theme: 'light' },
          newValue: { theme: 'dark' },
        },
      },
      'local'
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0].storageKey).toBe('settings');

    unsubscribe();
  });
});

// ============================================================================
// Sync echo suppression
// ============================================================================

describe('Sync echo suppression', () => {
  it('skips changes that match expected sync writes', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    const newValue = [{ id: 'g2', name: 'Synced Group', modified: 1 }];
    registerExpectedSyncWrite('groups', newValue);

    processStorageChange(
      {
        groups: {
          oldValue: [],
          newValue,
        },
      },
      'local'
    );

    expect(deltas).toHaveLength(0);

    unsubscribe();
  });

  it('processes changes when newValue differs from expected sync write', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    const expectedValue = [{ id: 'g2', name: 'Expected', modified: 1 }];
    const actualValue = [{ id: 'g2', name: 'User Modified', modified: 2 }];
    registerExpectedSyncWrite('groups', expectedValue);

    processStorageChange(
      {
        groups: {
          oldValue: [],
          newValue: actualValue,
        },
      },
      'local'
    );

    expect(deltas).toHaveLength(1);

    unsubscribe();
  });
});

// ============================================================================
// Ignore non-local storage areas
// ============================================================================

describe('processStorageChange', () => {
  it('ignores changes in sync storage area', () => {
    const deltas: GeneratedDelta[] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    processStorageChange(
      {
        groups: {
          oldValue: [],
          newValue: [{ id: 'g1', name: 'Test', modified: 1 }],
        },
      },
      'sync'
    );

    expect(deltas).toHaveLength(0);

    unsubscribe();
  });
});

// ============================================================================
// Utility functions
// ============================================================================

describe('isSyncableKey()', () => {
  it('returns true for groups', () => {
    expect(isSyncableKey('groups')).toBe(true);
  });

  it('returns true for settings', () => {
    expect(isSyncableKey('settings')).toBe(true);
  });

  it('returns false for unknown keys', () => {
    expect(isSyncableKey('some_random_key')).toBe(false);
  });
});

describe('isArrayKey()', () => {
  it('returns true for groups', () => {
    expect(isArrayKey('groups')).toBe(true);
  });

  it('returns false for settings (object key)', () => {
    expect(isArrayKey('settings')).toBe(false);
  });
});

describe('isObjectKey()', () => {
  it('returns true for settings', () => {
    expect(isObjectKey('settings')).toBe(true);
  });

  it('returns false for groups (array key)', () => {
    expect(isObjectKey('groups')).toBe(false);
  });
});

describe('deepEqual()', () => {
  it('returns true for identical primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
  });

  it('returns false for different primitives', () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'b')).toBe(false);
  });

  it('returns true for deeply equal objects', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
  });

  it('returns false for objects with different values', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('setSyncApplying()', () => {
  it('isSyncCurrentlyApplying() reflects the flag state', () => {
    setSyncApplying(true);
    expect(isSyncCurrentlyApplying()).toBe(true);
    setSyncApplying(false);
    // Note: isSyncCurrentlyApplying may still return true if expectedSyncWrites is non-empty
    // After clearing flag and no pending writes, it should be false
    expect(isSyncCurrentlyApplying()).toBe(false);
  });
});

// ============================================================================
// Phase 12 §Sync deviation proof — ADHD-03 parity assertion
//
// Rationale: 12-CONTEXT.md §Sync documents that the original plan listed six
// new top-level SYNCABLE_KEYS for Phase 12 sub-feature settings. The approved
// deviation instead places all three new sub-objects (visibleTabLimit, hardFocus,
// flowtimeTimer) inside the existing ADHDSettings object under the existing
// 'adhd_settings' OBJECT_KEY. This test is the living proof that the deep-merge
// path produces per-field object deltas for the new sub-objects — functionally
// equivalent to six top-level keys, but without the schema pollution.
// ============================================================================

describe('Phase 12 §Sync deviation — new sub-objects sync via adhd_settings OBJECT_KEY', () => {
  it('mutating ADHDSettings with Phase 12 sub-objects produces an ObjectDeltaPayload via the existing adhd_settings OBJECT_KEY', () => {
    const deltas: Parameters<Parameters<typeof onDeltasGenerated>[0]>[0] = [];
    const unsubscribe = onDeltasGenerated((d) => deltas.push(...d));

    // Old value: Phase 9 ADHDSettings (no Phase 12 sub-objects)
    const oldAdhd = {
      masterEnabled: false,
      autoSuspend: { enabled: false, thresholdMin: 30, whitelistDomains: [] },
      simplify: { enabled: false, aggressive: false },
      visualTime: { enabled: false, colorBlindSafe: false },
      brainDump: { enabled: false, tabContextDefault: true },
    };

    // New value: Phase 12 ADHDSettings with non-default sub-objects
    const newAdhd = {
      ...oldAdhd,
      visibleTabLimit: { enabled: true, limit: 15 },
      hardFocus: { enabled: false, domainMode: true },
      flowtimeTimer: { enabled: true, coefficient: 0.25 },
    };

    processStorageChange(
      {
        adhd_settings: {
          oldValue: oldAdhd,
          newValue: newAdhd,
        },
      },
      'local'
    );

    // Exactly one delta for the adhd_settings key (the OBJECT_KEY carrier)
    expect(deltas).toHaveLength(1);
    expect(deltas[0].storageKey).toBe('adhd_settings');

    // The delta payload contains the changed/added Phase 12 fields
    const payload = deltas[0].payload as { data: Record<string, unknown> };
    expect(payload.data).toHaveProperty('visibleTabLimit', { enabled: true, limit: 15 });
    expect(payload.data).toHaveProperty('hardFocus', { enabled: false, domainMode: true });
    expect(payload.data).toHaveProperty('flowtimeTimer', { enabled: true, coefficient: 0.25 });

    // NO new top-level storage key was added — only adhd_settings is the carrier
    const storageKeysInDeltas = deltas.map((d) => d.storageKey);
    expect(storageKeysInDeltas).not.toContain('adhd_visible_tab_limit_enabled');
    expect(storageKeysInDeltas).not.toContain('adhd_hard_focus_enabled');
    expect(storageKeysInDeltas).not.toContain('adhd_flowtime_enabled');
    expect(storageKeysInDeltas).toEqual(['adhd_settings']);

    unsubscribe();
  });

  it('adhd_settings is NOT in ARRAY_KEYS (prevents entity-level diff on Phase 12 sub-objects)', () => {
    expect(isArrayKey('adhd_settings')).toBe(false);
  });

  it('adhd_settings IS in OBJECT_KEYS (confirms field-level diff for Phase 12 sub-objects)', () => {
    expect(isObjectKey('adhd_settings')).toBe(true);
  });
});
