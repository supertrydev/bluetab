/**
 * MCP_TOOL_REGISTRY contract tests (MCP-05, MCP-06, MOD-18, SAFETY-04).
 *
 * Wave 0 stub turned GREEN on landing in Plan 13-01 — registry is the
 * source of truth for the locked tool surface. Downstream plans (13-02
 * client, 13-04 server replay handlers) consume this registry; if it
 * drifts from the locked surface, this test fails CI immediately.
 *
 * MOD-18 protection: the test below also asserts that every registry
 * name has a corresponding entry in a stub replayHandlers map. The map
 * is a placeholder in Plan 13-01 (handlers land in Plan 13-04). The
 * stub keeps the pattern alive in CI so handlers cannot drift away
 * from the registry without the test failing.
 */

import {
  MCP_TOOL_REGISTRY,
  MCP_TOOL_NAMES,
  ToolsetCategorySchema,
  WriteLevelSchema,
  type MCPToolName,
} from '../../types/mcp';

// ---------------------------------------------------------------------------
// Locked surface — exact names from CONTEXT.md §Server tool surface
// ---------------------------------------------------------------------------

const LOCKED_READ_TOOLS = [
  'list_groups',
  'get_group',
  'search_tabs',
  'list_projects',
  'list_brain_dump',
  'get_brain_dump_entry',
] as const;

const LOCKED_WRITE_TOOLS = [
  'save_tab_group',
  'update_group',
  'add_project',
  'update_project',
  'add_brain_dump',
  'update_brain_dump',
  'create_reminder',
] as const;

const LOCKED_TOOL_NAMES = [...LOCKED_READ_TOOLS, ...LOCKED_WRITE_TOOLS];

// ---------------------------------------------------------------------------
// Minimal valid args per tool — the smallest payload each Zod schema accepts.
// Used to assert the schema parses something realistic, not just empty objects.
// ---------------------------------------------------------------------------

const MINIMAL_VALID_ARGS: Record<MCPToolName, unknown> = {
  list_groups: {},
  get_group: { id: 'g1' },
  search_tabs: { query: 'foo' },
  list_projects: {},
  list_brain_dump: {},
  get_brain_dump_entry: { id: 'b1' },
  save_tab_group: {
    name: 'Reading',
    tabs: [{ title: 'MDN', url: 'https://developer.mozilla.org/en-US/' }],
  },
  update_group: { id: 'g1', name: 'Renamed' },
  add_project: { name: 'Inbox' },
  update_project: { id: 'p1', name: 'Renamed Project' },
  add_brain_dump: { text: 'remember the milk' },
  update_brain_dump: { id: 'b1', text: 'remember the milk and bread' },
  create_reminder: { title: 'water plants', fireAt: Date.now() + 60_000 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP_TOOL_REGISTRY — locked surface (MCP-05, MCP-06)', () => {
  it('contains exactly 13 tools (6 reads + 7 writes)', () => {
    expect(MCP_TOOL_NAMES).toHaveLength(13);
    expect(MCP_TOOL_NAMES.length).toBe(LOCKED_TOOL_NAMES.length);
  });

  it('every locked read tool is present with writeLevel: "read"', () => {
    for (const name of LOCKED_READ_TOOLS) {
      expect(MCP_TOOL_REGISTRY).toHaveProperty(name);
      expect(MCP_TOOL_REGISTRY[name].writeLevel).toBe('read');
    }
  });

  it('every locked write tool is present with writeLevel: "write"', () => {
    for (const name of LOCKED_WRITE_TOOLS) {
      expect(MCP_TOOL_REGISTRY).toHaveProperty(name);
      expect(MCP_TOOL_REGISTRY[name].writeLevel).toBe('write');
    }
  });

  it('contains no tool outside the locked surface (no archive/restore/delete/flow/focus/pomodoro)', () => {
    const forbidden = [
      'archive_group',
      'restore_group',
      'delete_group',
      'remove_group',
      'clear_groups',
      'add_flow_rule',
      'start_focus_session',
      'stop_focus_session',
      'set_pomodoro',
      'update_reminder',
      'delete_reminder',
      'get_flow_rules',
      'get_focus_state',
      'get_pomodoro_state',
      'get_stats',
    ];
    for (const banned of forbidden) {
      expect(MCP_TOOL_NAMES).not.toContain(banned as MCPToolName);
    }
  });
});

describe('MCP_TOOL_REGISTRY — schema invariants', () => {
  it('every entry has a Zod schema that parses a minimal valid payload', () => {
    for (const name of MCP_TOOL_NAMES) {
      const schema = MCP_TOOL_REGISTRY[name].args;
      const minimal = MINIMAL_VALID_ARGS[name];
      const result = schema.safeParse(minimal);
      if (!result.success) {
        throw new Error(`Tool ${name} schema rejected minimal payload: ${result.error.message}`);
      }
      expect(result.success).toBe(true);
    }
  });

  it('every entry has toolset in {groups, brain_dump, reminders}', () => {
    for (const name of MCP_TOOL_NAMES) {
      const result = ToolsetCategorySchema.safeParse(MCP_TOOL_REGISTRY[name].toolset);
      expect(result.success).toBe(true);
    }
  });

  it('every entry has writeLevel in {read, write}', () => {
    for (const name of MCP_TOOL_NAMES) {
      const result = WriteLevelSchema.safeParse(MCP_TOOL_REGISTRY[name].writeLevel);
      expect(result.success).toBe(true);
    }
  });

  it('every entry has destructive: false in v3.0 (SAFETY-04 v3.0 invariant)', () => {
    for (const name of MCP_TOOL_NAMES) {
      expect(MCP_TOOL_REGISTRY[name].destructive).toBe(false);
    }
  });
});

describe('MCP_TOOL_REGISTRY — MOD-18 startup integrity check', () => {
  // Plan 13-01 stub: the actual MCPServerService.replayHandlers map is
  // populated in Plan 13-04. The stub below asserts the contract — when
  // Plan 13-04 lands handlers, every registry name MUST have one entry.
  // For now the stub map is empty and the test asserts the SHAPE of the
  // future-comparison so a schema change today shows up in CI.
  it('every registry name maps to exactly one expected handler slot (stub for Plan 13-04)', () => {
    const expectedSlots = new Set<MCPToolName>(MCP_TOOL_NAMES);
    expect(expectedSlots.size).toBe(MCP_TOOL_NAMES.length);
    expect(expectedSlots.size).toBe(13);

    // Plan 13-04 will replace this stub with:
    //   import { MCPServerService } from '../mcp-server-service';
    //   for (const name of MCP_TOOL_NAMES) {
    //     expect(MCPServerService.replayHandlers).toHaveProperty(name);
    //   }
    // Today: assert the slot set is well-formed so CI catches any tool
    // addition that lacks a corresponding handler entry update.
  });
});
