/**
 * @module types/mcp
 *
 * WHY:  Phase 13 introduces a Bluetab MCP server (Supertry-hosted, reads a
 *       non-archival snapshot, queues writes) and a Bluetab MCP client
 *       (offscreen-document runtime, merges external tools into AI chat).
 *       Both surfaces share a locked tool registry, a locked snapshot
 *       payload shape, and credential/storage shapes that must NOT leak
 *       into sync deltas, stats, or logs (MCP-19).
 *
 * WHAT: - MCP_TOOL_REGISTRY: 13 tools (6 reads + 7 writes), all flagged
 *         destructive: false in v3.0. SAFETY-04 contract test iterates this
 *         registry; vacuously green today, flips live when a future
 *         destructive tool lands.
 *       - MCPSnapshotSchema: locked payload shape (groups + projects +
 *         brain_dump only). z.strict() rejects ANY extra top-level field
 *         to prevent silent scope creep at the snapshot layer.
 *       - MCPInvocationEntrySchema: per-entry shape for the
 *         mcp_invocations ring buffer (MCP-09 infrastructure; UI descoped
 *         in v3.0).
 *       - MCPClientEndpointSchema: shape stored under the
 *         mcp_client_endpoints non-syncable storage key.
 *       - CachedEndpointCapabilitiesSchema: per-endpoint tools/list cache.
 *
 * HOW:  Pure Zod schemas. No side effects. No imports from chrome.* or
 *       services. Importable from any layer (types, services, components,
 *       tests).
 *
 * NOT:  Does not perform validation at call sites — that is the caller's
 *       responsibility (e.g. mcp-server-service.replayWrite parses args
 *       through MCP_TOOL_REGISTRY[name].args before dispatching).
 *       Does not persist anything — see mcp-invocation-log.ts and
 *       mcp-credential-storage.ts (Plan 13-02) for storage paths.
 */

import { z } from 'zod';

// ============================================================================
// Toolset categories (locked — exactly 3)
// ============================================================================

/**
 * MCP-11: Per-client toolset toggles. Locked at 3 categories for v3.0.
 * Flow rules / focus / pomodoro / stats / RSS / ADHD / Teams are NOT
 * exposed in v3.0 — adding them requires a snapshot schema version bump.
 */
export const ToolsetCategorySchema = z.enum(['groups', 'brain_dump', 'reminders']);
export type ToolsetCategory = z.infer<typeof ToolsetCategorySchema>;

/**
 * Read vs write classification for MCP-11 enable/disable + audit clarity.
 */
export const WriteLevelSchema = z.enum(['read', 'write']);
export type WriteLevel = z.infer<typeof WriteLevelSchema>;

// ============================================================================
// Per-tool args schemas (Pattern 7 in 13-RESEARCH.md)
// ============================================================================

export const SaveTabGroupArgsSchema = z.object({
  name: z.string().min(1).max(200),
  tabs: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      notes: z.string().optional(),
    })
  ),
  notes: z.string().optional(),
});

export const UpdateGroupArgsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  notes: z.string().optional(),
  addTabs: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
        notes: z.string().optional(),
      })
    )
    .optional(),
  removeTabIds: z.array(z.string()).optional(),
});

export const AddProjectArgsSchema = z.object({
  name: z.string().min(1).max(200),
  groupIds: z.array(z.string()).optional(),
});

export const UpdateProjectArgsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  groupIds: z.array(z.string()).optional(),
});

export const AddBrainDumpArgsSchema = z.object({
  text: z.string().min(1).max(10_000),
  context: z
    .object({
      title: z.string().optional(),
      url: z.string().url().optional(),
    })
    .optional(),
});

export const UpdateBrainDumpArgsSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(10_000),
});

export const CreateReminderArgsSchema = z.object({
  title: z.string().min(1).max(200),
  fireAt: z.number().int().positive(),
  groupId: z.string().optional(),
});

// ============================================================================
// MCP_TOOL_REGISTRY — locked at 13 tools (6 reads + 7 writes)
// ============================================================================

/**
 * The complete locked tool surface for v3.0. CONTEXT.md §Server tool surface
 * forbids expansion: no archive/restore, no flow/focus/pomodoro control,
 * no deletes, no reminder updates.
 *
 * Every entry in v3.0 has destructive: false. The SAFETY-04 contract test
 * iterates this registry filtering destructive: true — empty set today,
 * green by vacuous truth. The day a destructive tool ships in v3.1+,
 * flipping the flag activates the confirmation-token gate documented in
 * docs/mcp-server-spec.md.
 */
export const MCP_TOOL_REGISTRY = {
  // Reads (6)
  list_groups: {
    args: z.object({}),
    title: 'List Groups',
    inputSchema: { type: 'object', properties: {} },
    toolset: 'groups' as ToolsetCategory,
    writeLevel: 'read' as WriteLevel,
    destructive: false,
    description: 'List the saved Bluetab tab groups (name, notes, tab count, dates). Use get_group for the tabs of one group.',
    annotations: { title: 'List Groups', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  get_group: {
    args: z.object({ id: z.string().min(1) }),
    title: 'Get Group',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'] },
    toolset: 'groups' as ToolsetCategory,
    writeLevel: 'read' as WriteLevel,
    destructive: false,
    description: 'Get one saved tab group by ID, including every tab title and URL.',
    annotations: { title: 'Get Group', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  search_tabs: {
    args: z.object({ query: z.string().min(1) }),
    title: 'Search Tabs',
    inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1 } }, required: ['query'] },
    toolset: 'groups' as ToolsetCategory,
    writeLevel: 'read' as WriteLevel,
    destructive: false,
    description: 'Search saved tabs in every group by title or URL text.',
    annotations: { title: 'Search Tabs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  list_projects: {
    args: z.object({}),
    title: 'List Projects',
    inputSchema: { type: 'object', properties: {} },
    toolset: 'groups' as ToolsetCategory,
    writeLevel: 'read' as WriteLevel,
    destructive: false,
    description: 'List Bluetab projects and the group IDs each project contains.',
    annotations: { title: 'List Projects', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  list_brain_dump: {
    args: z.object({}),
    title: 'List Brain Dump',
    inputSchema: { type: 'object', properties: {} },
    toolset: 'brain_dump' as ToolsetCategory,
    writeLevel: 'read' as WriteLevel,
    destructive: false,
    description: 'List Brain Dump notes (quick thoughts captured in Bluetab) with their page context.',
    annotations: { title: 'List Brain Dump', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  get_brain_dump_entry: {
    args: z.object({ id: z.string().min(1) }),
    title: 'Get Brain Dump Entry',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'] },
    toolset: 'brain_dump' as ToolsetCategory,
    writeLevel: 'read' as WriteLevel,
    destructive: false,
    description: 'Get one Brain Dump note by ID.',
    annotations: { title: 'Get Brain Dump Entry', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // Writes (7) — creation + modification only; no deletes
  save_tab_group: {
    args: SaveTabGroupArgsSchema,
    title: 'Save Tab Group',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        tabs: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string', format: 'uri' }, notes: { type: 'string' } }, required: ['title', 'url'] } },
        notes: { type: 'string' },
      },
      required: ['name', 'tabs'],
    },
    toolset: 'groups' as ToolsetCategory,
    writeLevel: 'write' as WriteLevel,
    destructive: false,
    description: 'Save a new tab group with the given tabs. The change is queued and applied the next time the Bluetab extension is open.',
    annotations: { title: 'Save Tab Group', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  update_group: {
    args: UpdateGroupArgsSchema,
    title: 'Update Group',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        notes: { type: 'string' },
        addTabs: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string', format: 'uri' }, notes: { type: 'string' } }, required: ['title', 'url'] } },
        removeTabIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
    },
    toolset: 'groups' as ToolsetCategory,
    writeLevel: 'write' as WriteLevel,
    destructive: false,
    description: 'Rename a saved group, edit its notes, add tabs or remove tabs by ID. The change is queued and applied the next time the Bluetab extension is open.',
    annotations: { title: 'Update Group', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  add_project: {
    args: AddProjectArgsSchema,
    title: 'Add Project',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, groupIds: { type: 'array', items: { type: 'string' } } },
      required: ['name'],
    },
    toolset: 'groups' as ToolsetCategory,
    writeLevel: 'write' as WriteLevel,
    destructive: false,
    description: 'Create a project, optionally containing existing group IDs. The change is queued and applied the next time the Bluetab extension is open.',
    annotations: { title: 'Add Project', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  update_project: {
    args: UpdateProjectArgsSchema,
    title: 'Update Project',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1, maxLength: 200 }, groupIds: { type: 'array', items: { type: 'string' } } },
      required: ['id'],
    },
    toolset: 'groups' as ToolsetCategory,
    writeLevel: 'write' as WriteLevel,
    destructive: false,
    description: 'Rename a project or replace its group list. The change is queued and applied the next time the Bluetab extension is open.',
    annotations: { title: 'Update Project', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  add_brain_dump: {
    args: AddBrainDumpArgsSchema,
    title: 'Add Brain Dump',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, maxLength: 10000 }, context: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string', format: 'uri' } } } },
      required: ['text'],
    },
    toolset: 'brain_dump' as ToolsetCategory,
    writeLevel: 'write' as WriteLevel,
    destructive: false,
    description: 'Add a Brain Dump note, optionally linked to a page title and URL. The change is queued and applied the next time the Bluetab extension is open.',
    annotations: { title: 'Add Brain Dump', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  update_brain_dump: {
    args: UpdateBrainDumpArgsSchema,
    title: 'Update Brain Dump',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 }, text: { type: 'string', minLength: 1, maxLength: 10000 } },
      required: ['id', 'text'],
    },
    toolset: 'brain_dump' as ToolsetCategory,
    writeLevel: 'write' as WriteLevel,
    destructive: false,
    description: 'Replace the text of a Brain Dump note. The change is queued and applied the next time the Bluetab extension is open.',
    annotations: { title: 'Update Brain Dump', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  create_reminder: {
    args: CreateReminderArgsSchema,
    title: 'Create Reminder',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, fireAt: { type: 'integer', minimum: 1 }, groupId: { type: 'string' } },
      required: ['title', 'fireAt'],
    },
    toolset: 'reminders' as ToolsetCategory,
    writeLevel: 'write' as WriteLevel,
    destructive: false,
    description: 'Create a reminder that fires at fireAt (Unix time in milliseconds), optionally linked to a group. The change is queued and applied the next time the Bluetab extension is open.',
    annotations: { title: 'Create Reminder', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
} as const;

export type MCPToolName = keyof typeof MCP_TOOL_REGISTRY;

/**
 * Locked tool name set — used by tests as a literal source of truth.
 */
export const MCP_TOOL_NAMES: readonly MCPToolName[] = Object.keys(
  MCP_TOOL_REGISTRY
) as MCPToolName[];

// ============================================================================
// Snapshot payload (locked — strict rejects extra top-level keys)
// ============================================================================

/**
 * The MCP snapshot pushed to Supertry on the 500 ms sync-engine debounce.
 *
 * .strict() is load-bearing: any future PR that tries to add `archive`,
 * `flow`, `focus`, `pomodoro`, `stats`, `rss`, `adhd`, `teams`, etc. as a
 * top-level field will fail Zod validation (the caller cannot build a
 * payload with extra keys). v3.1 expansion requires bumping `version`.
 */
export const MCPSnapshotSchema = z
  .object({
    version: z.literal(1),
    generated_at: z.number(),
    device_id: z.string(),
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        notes: z.string().optional(),
        tabs: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            url: z.string(),
            notes: z.string().optional(),
          })
        ),
        created: z.number(),
        modified: z.number(),
      })
    ),
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        groupIds: z.array(z.string()),
      })
    ),
    brain_dump: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        timestamp: z.number(),
        context: z
          .object({
            title: z.string().optional(),
            url: z.string().optional(),
          })
          .optional(),
      })
    ),
    client_toolsets: z
      .record(
        z.string(),
        z.object({
          groups: z.boolean(),
          brain_dump: z.boolean(),
          reminders: z.boolean(),
        })
      )
      .optional(),
  })
  .strict();

export type MCPSnapshot = z.infer<typeof MCPSnapshotSchema>;

// ============================================================================
// Invocation log entry (MCP-09 — infrastructure, no UI in v3.0)
// ============================================================================

/**
 * Per-entry shape for the mcp_invocations ring buffer.
 * Every MCP tool dispatch (immediate + replayed) writes one entry before
 * returning the result.
 */
export const MCPInvocationEntrySchema = z.object({
  timestamp: z.number(),
  source_client_id: z.string(),
  tool_name: z.string(),
  arg_summary: z.string().max(80),
  outcome: z.enum(['success', 'error', 'replayed']),
  error_message: z.string().optional(),
});

export type MCPInvocationEntry = z.infer<typeof MCPInvocationEntrySchema>;

// ============================================================================
// Client endpoint (stored under non-syncable mcp_client_endpoints — MCP-19)
// ============================================================================

/**
 * A user-added external MCP server. Lives at chrome.storage.local
 * under key 'mcp_client_endpoints'. NEVER syncs (MCP-19 contract).
 *
 * `authHeader` is a raw bearer token / header value. UI list responses
 * MUST strip it (see Plan 13-02 mcp-credential-storage.ts).
 */
export const MCPClientEndpointSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,29}$/, 'server_id: lowercase alnum + _-, 1-30 chars'),
  url: z.string().url(),
  authHeader: z.string().optional(),
  addedAt: z.number(),
});

export type MCPClientEndpoint = z.infer<typeof MCPClientEndpointSchema>;

// ============================================================================
// Cached tools/list capabilities (per-endpoint, non-syncable)
// ============================================================================

/**
 * Cached `tools/list` response per endpoint. Stored under
 * `mcp_endpoint_capabilities:<server_id>` (one key per endpoint).
 * NEVER syncs (MCP-19 contract).
 */
export const CachedEndpointCapabilitiesSchema = z.object({
  server_id: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().max(200),
      inputSchema: z.record(z.string(), z.unknown()),
    })
  ),
  fetched_at: z.number(),
  protocol_version: z.string(),
});

export type CachedEndpointCapabilities = z.infer<typeof CachedEndpointCapabilitiesSchema>;

// ============================================================================
// MCP storage keys (for MCP-19 sync-isolation contract test)
// ============================================================================

/**
 * Every MCP-related chrome.storage.local key in one list. The MCP-19
 * sync-isolation contract test asserts NONE of these appear in
 * SYNCABLE_KEYS / ARRAY_KEYS / OBJECT_KEYS.
 *
 * Note: mcp_endpoint_capabilities is per-endpoint with a server_id suffix
 * (`mcp_endpoint_capabilities:<id>`), so the contract test must also
 * verify the prefix string is not used as a syncable key.
 */
export const MCP_STORAGE_KEYS = [
  'mcp_client_endpoints',
  'mcp_server_settings',
  'mcp_invocations',
  'mcp_client_trust_acknowledged',
] as const;

export const MCP_STORAGE_KEY_PREFIXES = ['mcp_endpoint_capabilities'] as const;
