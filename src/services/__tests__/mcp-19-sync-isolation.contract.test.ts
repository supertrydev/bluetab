/**
 * MCP-19 sync-isolation contract — MCP credential / settings / log keys
 * are NEVER syncable.
 *
 * GREEN ON LANDING in Plan 13-01. Imports the actual SYNCABLE_KEYS list
 * and the per-bucket ARRAY_KEYS / OBJECT_KEYS used by delta-tracker.
 * Asserts the MCP_STORAGE_KEYS set has zero intersection with any
 * syncable-key list, and the per-endpoint capabilities-cache prefix
 * (mcp_endpoint_capabilities:*) is not present as a sync key.
 *
 * If any future PR accidentally adds 'mcp_client_endpoints' (or any
 * other MCP key) to SYNCABLE_KEYS / ARRAY_KEYS / OBJECT_KEYS, this
 * test fails CI immediately — bearer tokens MUST stay device-local.
 */

import { SYNCABLE_KEYS } from '../../types/sync';
import { MCP_STORAGE_KEYS, MCP_STORAGE_KEY_PREFIXES } from '../../types/mcp';

describe('MCP-19 — MCP storage keys are not syncable', () => {
  it('every MCP storage key is absent from SYNCABLE_KEYS', () => {
    for (const mcpKey of MCP_STORAGE_KEYS) {
      expect(SYNCABLE_KEYS).not.toContain(mcpKey);
    }
  });

  it('per-endpoint capabilities-cache prefix is not present as a syncable key', () => {
    for (const prefix of MCP_STORAGE_KEY_PREFIXES) {
      // Neither the bare prefix nor any prefix:variant should appear.
      const syncableKeys = SYNCABLE_KEYS as readonly string[];
      const hit = syncableKeys.find((k) => k === prefix || k.startsWith(`${prefix}:`));
      expect(hit).toBeUndefined();
    }
  });

  it('the locked MCP storage key set contains the expected 4 entries', () => {
    // Defensive — if MCP_STORAGE_KEYS drifts, the test above silently
    // covers fewer keys. This assertion makes the drift visible.
    expect([...MCP_STORAGE_KEYS].sort()).toEqual(
      [
        'mcp_client_endpoints',
        'mcp_client_trust_acknowledged',
        'mcp_invocations',
        'mcp_server_settings',
      ].sort()
    );
  });
});

describe('MCP-19 — delta-tracker bucket-level isolation', () => {
  it('no MCP storage key appears in delta-tracker ARRAY_KEYS or OBJECT_KEYS via static grep', () => {
    // Static-source grep against delta-tracker.ts — same approach as
    // mcp-19-stats-isolation.contract.test.ts. Cheap + catches any
    // future PR that adds an MCP key to either bucket.
    const fs = require('fs');
    const path = require('path');
    const file = path.resolve(__dirname, '../delta-tracker.ts');
    const src = fs.readFileSync(file, 'utf-8');

    // Strip comments so doc-notes don't false-positive.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    for (const mcpKey of MCP_STORAGE_KEYS) {
      // Match a string literal containing the MCP key in either bucket.
      // The two bucket arrays are named ARRAY_KEYS and OBJECT_KEYS.
      const arrayBucket = stripped.match(/ARRAY_KEYS\s*:\s*SyncableKey\[\]\s*=\s*\[[\s\S]*?\]/);
      const objectBucket = stripped.match(/OBJECT_KEYS\s*:\s*SyncableKey\[\]\s*=\s*\[[\s\S]*?\]/);

      if (arrayBucket) {
        expect(arrayBucket[0]).not.toContain(`'${mcpKey}'`);
        expect(arrayBucket[0]).not.toContain(`"${mcpKey}"`);
      }
      if (objectBucket) {
        expect(objectBucket[0]).not.toContain(`'${mcpKey}'`);
        expect(objectBucket[0]).not.toContain(`"${mcpKey}"`);
      }
    }
  });
});

describe('MCP-19 — snapshot push is not coupled to Cloud Sync', () => {
  it('keeps MCP snapshot scheduling out of SyncEngine', () => {
    const fs = require('fs');
    const path = require('path');
    const file = path.resolve(__dirname, '../sync-engine.ts');
    const src = fs.readFileSync(file, 'utf-8');

    expect(src).not.toContain("import { MCPServerService } from './mcp-server-service'");
    expect(src).not.toContain('MCPServerService.pushSnapshotIfEnabled()');
    expect(src).not.toContain('MCPServerService.scheduleSnapshotPush()');
  });

  it('keeps the MCP storage-change snapshot trigger in the service worker', () => {
    const fs = require('fs');
    const path = require('path');
    const file = path.resolve(__dirname, '../../background/service-worker.ts');
    const src = fs.readFileSync(file, 'utf-8');

    expect(src).toContain('MCP_SNAPSHOT_SOURCE_KEYS');
    expect(src).toContain('MCPServerService.scheduleSnapshotPush()');
    expect(src).toContain('brain_dump_inbox');
  });
});
