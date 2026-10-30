/**
 * @module services/mcp-invocation-log
 *
 * WHY:  MCP-09 ships infrastructure-only in v3.0 — every MCP tool dispatch
 *       (immediate AND replayed) must persist a log entry before returning.
 *       The UI surface is descoped to a future Bluetab-wide activity log
 *       the user plans separately. Shipping the storage layer now means
 *       that future work needs zero schema migration.
 *
 * WHAT: - logInvocation(entry): pushes one MCPInvocationEntry into a ring
 *         buffer at chrome.storage.local['mcp_invocations']. Caps at 1000
 *         entries (RingBuffer evicts oldest), prunes anything older than
 *         30 days on every write (soft TTL), truncates arg_summary to
 *         <=80 chars defensively.
 *       - tryGetAll(): returns the current buffer for devtools inspection
 *         (no UI consumes this in v3.0).
 *
 * HOW:  Rehydrate-on-write — read existing buffer from storage, push the
 *       new entry through RingBuffer (which handles cap), persist back.
 *       30-day prune runs unconditionally; cheap (filter on already-loaded
 *       array). Storage round-trip is acceptable: MCP dispatch latency is
 *       network-bound (Supertry round-trip) so a single chrome.storage.local
 *       set is in the noise.
 *
 * NOT:  Does not synchronize — mcp_invocations is NOT in SYNCABLE_KEYS
 *       (MCP-19 contract enforces this). Does not surface UI — Plan 13-X
 *       any future activity-log feature reads via tryGetAll() or directly
 *       from chrome.storage.local. Does not redact — callers ensure
 *       arg_summary contains no secrets (use redactSecrets helper from
 *       Plan 13-02 src/utils/redact-secrets.ts when serializing args).
 */

import { RingBuffer } from '../utils/ring-buffer';
import { Storage } from '../utils/storage';
import type { MCPInvocationEntry } from '../types/mcp';

const STORAGE_KEY = 'mcp_invocations';
const CAP = 1000;
const SOFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ARG_SUMMARY_MAX_CHARS = 80;

const ringBuffer = new RingBuffer<MCPInvocationEntry>(CAP);

/**
 * Append one invocation entry. Prunes entries older than 30 days first,
 * then enforces the 1000-entry cap, then persists.
 *
 * arg_summary is truncated to 80 chars defensively even if the caller
 * passes something longer — Zod's MCPInvocationEntrySchema also enforces
 * this, but defense in depth keeps malformed callers from blowing the cap.
 */
export async function logInvocation(entry: MCPInvocationEntry): Promise<void> {
  const existing = (await Storage.get<MCPInvocationEntry[]>(STORAGE_KEY)) ?? [];
  const cutoff = Date.now() - SOFT_TTL_MS;
  const pruned = existing.filter((e) => e.timestamp >= cutoff);

  const truncated: MCPInvocationEntry = {
    ...entry,
    arg_summary:
      entry.arg_summary.length > ARG_SUMMARY_MAX_CHARS
        ? entry.arg_summary.slice(0, ARG_SUMMARY_MAX_CHARS)
        : entry.arg_summary,
  };

  const next = ringBuffer.push(pruned, truncated);
  await Storage.set(STORAGE_KEY, next);
}

/**
 * Devtools inspection helper. Returns the current buffer.
 * No UI consumes this in v3.0.
 */
export async function tryGetAll(): Promise<MCPInvocationEntry[]> {
  return (await Storage.get<MCPInvocationEntry[]>(STORAGE_KEY)) ?? [];
}
