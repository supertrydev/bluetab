/**
 * MCPServerService behavior tests (MCP-01, MCP-03, MCP-07, MCP-11).
 *
 * Plan 13-01 landed test.todo placeholders; Plan 13-04 turns them into
 * live assertions against the production module created in this plan.
 *
 * Coverage:
 *   - pushSnapshotIfEnabled gates on enable flag + kill switch + token
 *   - buildSnapshot includes locked scope only, archive-filtered,
 *     URL-redacted, MCPSnapshotSchema-validated
 *   - dispatchTool routes through services (XC-01 behavioral complement)
 *   - dispatchTool toolset filter (MCP-11)
 *   - replayWrite Zod parse + per-record LWW + invocation log entry
 */

import { MCPServerService, buildSnapshot } from '../mcp-server-service';
import { Storage } from '@/utils/storage';
import { KillSwitchService } from '../kill-switch-service';
import { BrainDumpService } from '../brain-dump-service';
import { ReminderService } from '../reminder-service';
import * as AuthState from '@/utils/auth-state';
import { logInvocation } from '../mcp-invocation-log';
import type { TabGroup, Project } from '@/types/models';
import type { BrainDumpEntry } from '@/types/adhd';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    addProject: jest.fn(),
    updateProject: jest.fn(),
    assignGroupsToProject: jest.fn(),
    getProjects: jest.fn(),
  },
}));

jest.mock('../kill-switch-service', () => ({
  KillSwitchService: {
    readMCPServerKillSwitch: jest.fn(),
  },
}));

jest.mock('../brain-dump-service', () => ({
  BrainDumpService: {
    add: jest.fn(),
    updateEntry: jest.fn(),
  },
}));

jest.mock('../reminder-service', () => ({
  ReminderService: {
    create: jest.fn(),
  },
}));

jest.mock('@/utils/auth-state', () => ({
  getAccessToken: jest.fn(),
}));

jest.mock('../mcp-invocation-log', () => ({
  logInvocation: jest.fn().mockResolvedValue(undefined),
}));

const mockGet = Storage.get as jest.Mock;
const mockSet = Storage.set as jest.Mock;
const mockAddProject = Storage.addProject as jest.Mock;
const mockUpdateProject = Storage.updateProject as jest.Mock;
const mockAssignGroupsToProject = Storage.assignGroupsToProject as jest.Mock;
const mockGetProjects = Storage.getProjects as jest.Mock;
const mockKill = KillSwitchService.readMCPServerKillSwitch as jest.Mock;
const mockBDAdd = BrainDumpService.add as jest.Mock;
const mockBDUpdate = BrainDumpService.updateEntry as jest.Mock;
const mockReminderCreate = ReminderService.create as jest.Mock;
const mockGetToken = AuthState.getAccessToken as jest.Mock;
const mockLogInvocation = logInvocation as jest.Mock;

// Mock fetch globally (replayed per test).
const mockFetch = jest.fn();
(global as Record<string, unknown>).fetch = mockFetch;

// Polyfill CompressionStream for Node test environment if missing.
if (typeof (global as Record<string, unknown>).CompressionStream === 'undefined') {
  (global as Record<string, unknown>).CompressionStream = class {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    constructor() {
      // Identity transform — passes bytes through. Sufficient for the
      // test contract: pushSnapshotIfEnabled must call fetch with a
      // gzip header; the actual byte content does not need real gzip.
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      this.readable = readable;
      this.writable = writable;
    }
  };
}

beforeEach(() => {
  jest.useRealTimers();
  mockGet.mockReset();
  mockSet.mockReset();
  mockAddProject.mockReset();
  mockUpdateProject.mockReset();
  mockAssignGroupsToProject.mockReset();
  mockGetProjects.mockReset();
  mockKill.mockReset();
  mockBDAdd.mockReset();
  mockBDUpdate.mockReset();
  mockReminderCreate.mockReset();
  mockGetToken.mockReset();
  mockLogInvocation.mockReset();
  mockFetch.mockReset();

  mockSet.mockResolvedValue(undefined);
  mockKill.mockResolvedValue(false);
  mockGetToken.mockResolvedValue('test-token');
  mockGetProjects.mockResolvedValue([]);
  mockLogInvocation.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

// Helper: storage by-key mock that returns null for unknown keys.
function storageMap(map: Record<string, unknown>) {
  mockGet.mockImplementation(async (key: string) => {
    return key in map ? map[key] : null;
  });
}

// ============================================================================
// pushSnapshotIfEnabled — gating
// ============================================================================

describe('MCPServerService.pushSnapshotIfEnabled — gating', () => {
  it('returns immediately when mcp_server_enabled is false', async () => {
    storageMap({ mcp_server_enabled: false });
    await MCPServerService.pushSnapshotIfEnabled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns immediately when mcp_server_enabled is unset', async () => {
    storageMap({});
    await MCPServerService.pushSnapshotIfEnabled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns immediately when kill switch is active', async () => {
    storageMap({ mcp_server_enabled: true });
    mockKill.mockResolvedValue(true);
    await MCPServerService.pushSnapshotIfEnabled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns immediately when no auth token is available', async () => {
    storageMap({ mcp_server_enabled: true });
    mockGetToken.mockResolvedValue(null);
    await MCPServerService.pushSnapshotIfEnabled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POSTs the snapshot with Content-Encoding: gzip when enabled', async () => {
    storageMap({
      mcp_server_enabled: true,
      groups: [],
      projects: [],
      brain_dump_inbox: [],
      mcp_device_id: 'test-device',
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await MCPServerService.pushSnapshotIfEnabled();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/mcp\/snapshot$/);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Encoding']).toBe('gzip');
    expect(init.headers['Authorization']).toBe('Bearer test-token');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('catches network errors silently', async () => {
    storageMap({
      mcp_server_enabled: true,
      groups: [],
      projects: [],
      brain_dump_inbox: [],
      mcp_device_id: 'test-device',
    });
    mockFetch.mockRejectedValue(new Error('network down'));

    await expect(MCPServerService.pushSnapshotIfEnabled()).resolves.toBeUndefined();
  });

  it('debounces scheduled snapshot pushes for storage-change triggers', async () => {
    storageMap({
      mcp_server_enabled: true,
      groups: [],
      projects: [],
      brain_dump_inbox: [],
      mcp_device_id: 'test-device',
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    MCPServerService.scheduleSnapshotPush();
    MCPServerService.scheduleSnapshotPush();

    expect(mockFetch).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 850));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// buildSnapshot — scope, redaction, schema validation
// ============================================================================

describe('MCPServerService.buildSnapshot — scope + redaction', () => {
  it('includes only groups, projects, brain_dump (locked scope)', async () => {
    storageMap({
      groups: [],
      projects: [],
      brain_dump_inbox: [],
      mcp_device_id: 'dev',
    });
    const snap = await buildSnapshot();
    expect(Object.keys(snap).sort()).toEqual(
      ['brain_dump', 'device_id', 'generated_at', 'groups', 'projects', 'version'].sort(),
    );
  });

  it('filters archived groups out of the payload', async () => {
    const groups = [
      { id: 'g1', name: 'live', tabs: [], created: 1, modified: 2 } as TabGroup,
      {
        id: 'g2',
        name: 'archived',
        tabs: [],
        created: 1,
        modified: 2,
        archived: true,
      } as TabGroup & { archived: true },
    ];
    storageMap({
      groups,
      projects: [],
      brain_dump_inbox: [],
      mcp_device_id: 'dev',
    });
    const snap = await buildSnapshot();
    expect(snap.groups).toHaveLength(1);
    expect(snap.groups[0].id).toBe('g1');
  });

  it('passes every URL through redactSensitiveParams (tab URLs)', async () => {
    const groups: TabGroup[] = [
      {
        id: 'g1',
        name: 'one',
        tabs: [
          {
            id: 't1',
            url: 'https://example.com/?token=secret',
            title: 'Page',
            timestamp: 1,
            groupId: 'g1',
          },
        ],
        created: 1,
        modified: 2,
      },
    ];
    storageMap({
      groups,
      projects: [],
      brain_dump_inbox: [],
      mcp_device_id: 'dev',
    });
    const snap = await buildSnapshot();
    expect(snap.groups[0].tabs[0].url).not.toContain('secret');
    expect(snap.groups[0].tabs[0].url).toMatch(/REDACTED/);
  });

  it('passes every brain-dump captured-tab URL through redactSensitiveParams', async () => {
    const entries: BrainDumpEntry[] = [
      {
        id: 'b1',
        text: 'note',
        createdAt: 1,
        tabContext: {
          url: 'https://example.com/?session=top-secret',
          title: 'Page',
        },
      },
    ];
    storageMap({
      groups: [],
      projects: [],
      brain_dump_inbox: entries,
      mcp_device_id: 'dev',
    });
    const snap = await buildSnapshot();
    expect(snap.brain_dump[0].context?.url).not.toContain('top-secret');
    expect(snap.brain_dump[0].context?.url).toMatch(/REDACTED/);
  });

  it('emits projects with derived groupIds based on group.projectId pointers', async () => {
    const projects: Project[] = [
      {
        id: 'p1',
        name: 'Work',
        color: 'blue',
        icon: 'folder',
        searchScope: 'project',
        created: 1,
        modified: 1,
      },
    ];
    const groups: TabGroup[] = [
      { id: 'g1', name: 'a', tabs: [], created: 1, modified: 1, projectId: 'p1' },
      { id: 'g2', name: 'b', tabs: [], created: 1, modified: 1 },
    ];
    storageMap({ groups, projects, brain_dump_inbox: [], mcp_device_id: 'dev' });
    const snap = await buildSnapshot();
    expect(snap.projects[0].groupIds).toEqual(['g1']);
  });

  it('serializes client toolset prefs into client_toolsets when present', async () => {
    storageMap({
      groups: [],
      projects: [],
      brain_dump_inbox: [],
      mcp_device_id: 'dev',
      mcp_server_toolset_prefs: {
        'codex-cli': ['groups', 'reminders'],
      },
    });

    const snap = await buildSnapshot();

    expect(snap.client_toolsets).toEqual({
      'codex-cli': {
        groups: true,
        brain_dump: false,
        reminders: true,
      },
    });
  });

  it('parses through MCPSnapshotSchema.strict() — payload shape is locked', async () => {
    storageMap({ groups: [], projects: [], brain_dump_inbox: [], mcp_device_id: 'dev' });
    const snap = await buildSnapshot();
    // Snapshot must have version: 1.
    expect(snap.version).toBe(1);
    // No surprise top-level keys (strict() would have thrown if any
    // existed — the success of this assertion is the test).
    expect(snap).not.toHaveProperty('archive');
    expect(snap).not.toHaveProperty('flow');
    expect(snap).not.toHaveProperty('focus');
    expect(snap).not.toHaveProperty('pomodoro');
    expect(snap).not.toHaveProperty('stats');
  });
});

// ============================================================================
// dispatchTool — XC-01 + MCP-11 + invocation log
// ============================================================================

describe('MCPServerService.dispatchTool — write tools route through services (XC-01)', () => {
  it('add_brain_dump dispatches through BrainDumpService.add', async () => {
    storageMap({ mcp_server_toolset_prefs: null });
    mockBDAdd.mockResolvedValue([{ id: 'b1', text: 'hi', createdAt: 1 }]);

    const out = await MCPServerService.dispatchTool(
      'add_brain_dump',
      { text: 'hi' },
      { source_client_id: 'claude', invocationId: 'inv-1' },
    );

    expect(mockBDAdd).toHaveBeenCalledWith({ text: 'hi' });
    expect(out).toEqual({ id: 'b1', status: 'created' });
    expect(mockLogInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_name: 'add_brain_dump',
        outcome: 'success',
      }),
    );
  });

  it('create_reminder dispatches through ReminderService.create', async () => {
    storageMap({ mcp_server_toolset_prefs: null });
    mockReminderCreate.mockResolvedValue(undefined);

    await MCPServerService.dispatchTool(
      'create_reminder',
      { title: 'review later', fireAt: Date.now() + 60_000 },
      { source_client_id: 'claude', invocationId: 'inv-2' },
    );

    expect(mockReminderCreate).toHaveBeenCalledWith(
      expect.objectContaining({ targetName: 'review later', notificationOnly: true }),
    );
  });

  it('add_project dispatches through Storage.addProject', async () => {
    storageMap({ mcp_server_toolset_prefs: null });
    mockAddProject.mockResolvedValue(undefined);

    await MCPServerService.dispatchTool(
      'add_project',
      { name: 'New' },
      { source_client_id: 'claude', invocationId: 'inv-3' },
    );

    expect(mockAddProject).toHaveBeenCalledTimes(1);
    expect(mockAddProject.mock.calls[0][0].name).toBe('New');
  });
});

describe('MCPServerService.dispatchTool — toolset filter (MCP-11)', () => {
  it('returns toolset_disabled when client prefs exclude the toolset', async () => {
    storageMap({
      // claude-1 is allowed only `groups`; brain_dump tools must be denied.
      mcp_server_toolset_prefs: { 'claude-1': ['groups'] },
    });

    const out = await MCPServerService.dispatchTool(
      'add_brain_dump',
      { text: 'hi' },
      { source_client_id: 'claude-1', invocationId: 'inv-4' },
    );

    expect(out).toEqual({ status: 'toolset_disabled', toolset: 'brain_dump' });
    expect(mockBDAdd).not.toHaveBeenCalled();
    expect(mockLogInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'error',
        error_message: expect.stringContaining('toolset_disabled'),
      }),
    );
  });

  it('allows the call when client has no prefs entry (default-on)', async () => {
    storageMap({ mcp_server_toolset_prefs: {} });
    mockBDAdd.mockResolvedValue([{ id: 'b1', text: 'hi', createdAt: 1 }]);

    await MCPServerService.dispatchTool(
      'add_brain_dump',
      { text: 'hi' },
      { source_client_id: 'unknown-client', invocationId: 'inv-5' },
    );

    expect(mockBDAdd).toHaveBeenCalled();
  });
});

describe('MCPServerService.dispatchTool — unknown tool', () => {
  it('returns -32601 method-not-found for an unknown tool name', async () => {
    storageMap({ mcp_server_toolset_prefs: null });
    const out = await MCPServerService.dispatchTool(
      'totally_made_up',
      {},
      { source_client_id: 'claude', invocationId: 'inv-x' },
    );
    expect(out).toMatchObject({ status: 'error', code: -32601 });
    expect(mockLogInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', tool_name: 'totally_made_up' }),
    );
  });
});

// ============================================================================
// replayWrite — Zod parse + LWW + invocation log
// ============================================================================

describe('MCPServerService.replayWrite — Zod validation', () => {
  it('drops malformed events without throwing', async () => {
    await expect(
      MCPServerService.replayWrite({ type: 'mcp-replay', clientId: 'x' }),
    ).resolves.toBeUndefined();
    expect(mockLogInvocation).not.toHaveBeenCalled();
  });

  it('parses well-formed events and dispatches through the write handler', async () => {
    storageMap({
      mcp_server_toolset_prefs: null,
      brain_dump_inbox: [],
    });
    mockBDAdd.mockResolvedValue([{ id: 'b-new', text: 'replayed', createdAt: 1 }]);

    await MCPServerService.replayWrite({
      type: 'mcp-replay',
      clientId: 'claude',
      toolName: 'add_brain_dump',
      args: { text: 'replayed' },
      queuedAt: 1,
      invocationId: 'inv-rep-1',
    });

    expect(mockBDAdd).toHaveBeenCalledWith({ text: 'replayed' });
    expect(mockLogInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_name: 'add_brain_dump',
        outcome: 'replayed',
      }),
    );
  });
});

describe('MCPServerService.replayWrite — record-level LWW', () => {
  it('drops the replay when the local record is newer (update_brain_dump)', async () => {
    // Local entry's updatedAt = 1000; queued event is at 500 — local wins.
    const entries: BrainDumpEntry[] = [
      { id: 'b1', text: 'local', createdAt: 100, updatedAt: 1000 },
    ];
    storageMap({
      mcp_server_toolset_prefs: null,
      brain_dump_inbox: entries,
    });

    await MCPServerService.replayWrite({
      type: 'mcp-replay',
      clientId: 'claude',
      toolName: 'update_brain_dump',
      args: { id: 'b1', text: 'replay-text' },
      queuedAt: 500,
      invocationId: 'inv-lww',
    });

    expect(mockBDUpdate).not.toHaveBeenCalled();
    expect(mockLogInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'replayed',
        error_message: expect.stringContaining('superseded'),
      }),
    );
  });

  it('applies the replay when the local record is older (update_brain_dump)', async () => {
    const entries: BrainDumpEntry[] = [
      { id: 'b1', text: 'local', createdAt: 100, updatedAt: 200 },
    ];
    storageMap({
      mcp_server_toolset_prefs: null,
      brain_dump_inbox: entries,
    });
    mockBDUpdate.mockResolvedValue(entries);

    await MCPServerService.replayWrite({
      type: 'mcp-replay',
      clientId: 'claude',
      toolName: 'update_brain_dump',
      args: { id: 'b1', text: 'replay-text' },
      queuedAt: 1000,
      invocationId: 'inv-lww-2',
    });

    expect(mockBDUpdate).toHaveBeenCalledWith('b1', { text: 'replay-text' });
    expect(mockLogInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'replayed',
      }),
    );
  });

  it('rejects non-write tools on the replay path', async () => {
    storageMap({});
    await MCPServerService.replayWrite({
      type: 'mcp-replay',
      clientId: 'claude',
      toolName: 'list_groups',
      args: {},
      queuedAt: 1,
      invocationId: 'inv-x',
    });
    expect(mockLogInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'error',
        error_message: expect.stringContaining('non-write'),
      }),
    );
  });
});
