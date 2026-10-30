/**
 * MCPInvocationLog ring buffer + TTL contract (MCP-09 infrastructure).
 *
 * GREEN ON LANDING in Plan 13-01. Plan 13-04 wires the call sites
 * (replayWrite + dispatch) that produce entries; this test validates
 * the storage shape, cap enforcement, TTL pruning, and arg_summary
 * truncation independently of the producer.
 */

import { logInvocation, tryGetAll } from '../mcp-invocation-log';
import { Storage } from '../../utils/storage';
import type { MCPInvocationEntry } from '../../types/mcp';

const STORAGE_KEY = 'mcp_invocations';

// In-memory backing for chrome.storage.local stand-in.
const memory = new Map<string, unknown>();

beforeEach(() => {
  memory.clear();
  jest.spyOn(Storage, 'get').mockImplementation(async (key: string) => {
    return (memory.get(key) as never) ?? null;
  });
  jest.spyOn(Storage, 'set').mockImplementation(async (key: string, value: unknown) => {
    memory.set(key, value);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeEntry(overrides: Partial<MCPInvocationEntry> = {}): MCPInvocationEntry {
  return {
    timestamp: Date.now(),
    source_client_id: 'claude-desktop',
    tool_name: 'list_groups',
    arg_summary: '{}',
    outcome: 'success',
    ...overrides,
  };
}

describe('logInvocation — basic write path', () => {
  it('persists a single entry to mcp_invocations', async () => {
    const entry = makeEntry();
    await logInvocation(entry);

    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0].tool_name).toBe('list_groups');
  });

  it('appends to existing buffer rather than overwriting', async () => {
    await logInvocation(makeEntry({ tool_name: 'list_groups' }));
    await logInvocation(makeEntry({ tool_name: 'add_brain_dump' }));

    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored).toHaveLength(2);
    expect(stored.map((e) => e.tool_name)).toEqual(['list_groups', 'add_brain_dump']);
  });

  it('tryGetAll returns the current buffer (devtools inspection helper)', async () => {
    await logInvocation(makeEntry({ tool_name: 'list_groups' }));
    const all = await tryGetAll();
    expect(all).toHaveLength(1);
    expect(all[0].tool_name).toBe('list_groups');
  });

  it('tryGetAll returns [] when storage is empty', async () => {
    const all = await tryGetAll();
    expect(all).toEqual([]);
  });
});

describe('logInvocation — ring buffer cap of 1000', () => {
  it('evicts the oldest entry when the buffer is full', async () => {
    // Pre-seed storage with exactly 1000 entries.
    const seeded: MCPInvocationEntry[] = [];
    const baseTs = Date.now();
    for (let i = 0; i < 1000; i++) {
      seeded.push(makeEntry({ tool_name: `tool-${i}`, timestamp: baseTs - (1000 - i) }));
    }
    memory.set(STORAGE_KEY, seeded);

    // Push one more — the oldest (tool-0) MUST be evicted.
    await logInvocation(makeEntry({ tool_name: 'newest', timestamp: baseTs }));

    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored).toHaveLength(1000);
    expect(stored.map((e) => e.tool_name)).not.toContain('tool-0');
    expect(stored[stored.length - 1].tool_name).toBe('newest');
  });
});

describe('logInvocation — 30-day soft TTL prune', () => {
  it('drops entries older than 30 days on next write', async () => {
    const now = Date.now();
    const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
    const stale: MCPInvocationEntry[] = [
      makeEntry({ tool_name: 'old', timestamp: now - THIRTY_ONE_DAYS_MS }),
      makeEntry({ tool_name: 'recent', timestamp: now - 24 * 60 * 60 * 1000 }),
    ];
    memory.set(STORAGE_KEY, stale);

    await logInvocation(makeEntry({ tool_name: 'fresh', timestamp: now }));

    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored.map((e) => e.tool_name)).toEqual(['recent', 'fresh']);
    expect(stored.find((e) => e.tool_name === 'old')).toBeUndefined();
  });

  it('keeps entries exactly at the 30-day boundary (>=cutoff)', async () => {
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    // Entry exactly at cutoff should be retained.
    memory.set(STORAGE_KEY, [
      makeEntry({ tool_name: 'boundary', timestamp: now - THIRTY_DAYS_MS + 1 }),
    ]);

    await logInvocation(makeEntry({ tool_name: 'fresh', timestamp: now }));

    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored.map((e) => e.tool_name)).toContain('boundary');
  });
});

describe('logInvocation — arg_summary truncation to <=80 chars', () => {
  it('truncates long arg_summary defensively to 80 chars', async () => {
    const long = 'a'.repeat(200);
    await logInvocation(makeEntry({ arg_summary: long }));

    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored[0].arg_summary.length).toBe(80);
    expect(stored[0].arg_summary).toBe('a'.repeat(80));
  });

  it('leaves short arg_summary untouched', async () => {
    await logInvocation(makeEntry({ arg_summary: '{"id":"g1"}' }));

    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored[0].arg_summary).toBe('{"id":"g1"}');
  });
});

describe('logInvocation — outcome variants', () => {
  it('persists outcome: success', async () => {
    await logInvocation(makeEntry({ outcome: 'success' }));
    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored[0].outcome).toBe('success');
  });

  it('persists outcome: error with error_message', async () => {
    await logInvocation(
      makeEntry({ outcome: 'error', error_message: 'group not found' })
    );
    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored[0].outcome).toBe('error');
    expect(stored[0].error_message).toBe('group not found');
  });

  it('persists outcome: replayed (offline write queue replay path)', async () => {
    await logInvocation(makeEntry({ outcome: 'replayed' }));
    const stored = memory.get(STORAGE_KEY) as MCPInvocationEntry[];
    expect(stored[0].outcome).toBe('replayed');
  });
});

describe('MCPSnapshotSchema strict mode (scope-creep guard)', () => {
  // Co-located here for ergonomic file count — covered separately so the
  // snapshot schema's load-bearing .strict() guarantee is asserted alongside
  // the invocation-log infra.
  it('rejects any extra top-level field (archive, flow, focus, pomodoro, stats, rss, adhd, teams)', () => {
    const { MCPSnapshotSchema } = require('../../types/mcp');
    const valid = {
      version: 1,
      generated_at: Date.now(),
      device_id: 'dev-1',
      groups: [],
      projects: [],
      brain_dump: [],
    };
    expect(MCPSnapshotSchema.safeParse(valid).success).toBe(true);

    const FORBIDDEN_EXTRA_KEYS = [
      'archive',
      'flow',
      'focus',
      'pomodoro',
      'flowtime',
      'stats',
      'rss',
      'adhd',
      'teams',
      'history',
      'offline_reading',
      'mcp_invocations',
    ];
    for (const key of FORBIDDEN_EXTRA_KEYS) {
      const result = MCPSnapshotSchema.safeParse({ ...valid, [key]: {} });
      expect(result.success).toBe(false);
    }
  });
});
