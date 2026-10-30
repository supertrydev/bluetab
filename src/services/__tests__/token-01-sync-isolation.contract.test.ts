/**
 * TOKEN-01 sync-isolation contract — integration token/settings/state keys
 * MUST NOT be syncable.
 *
 * GREEN ON LANDING in Plan 14-01. Mirrors MCP-19 sync-isolation pattern.
 * Asserts that the 6 integration storage key families have zero intersection
 * with SYNCABLE_KEYS (which drives delta-tracker sync to Supertry).
 *
 * TOKEN-01 contract: integration tokens are device-local only.
 * They must NEVER appear in sync deltas, stats, or console logs.
 */

import { SYNCABLE_KEYS } from '../../types/sync';

const INTEGRATION_EXACT_KEYS = [
  'integration_tokens',
  'integration_settings',
  'integration_pkce_state',
];

const INTEGRATION_PREFIX_FAMILIES = [
  'integration_consent_',
  'integration_capabilities_',
  'integration_reauth_required:',
];

describe('TOKEN-01 — integration storage keys are not syncable', () => {
  it('integration_tokens is not in SYNCABLE_KEYS', () => {
    expect(SYNCABLE_KEYS).not.toContain('integration_tokens');
  });

  it('integration_settings is not in SYNCABLE_KEYS', () => {
    expect(SYNCABLE_KEYS).not.toContain('integration_settings');
  });

  it('integration_pkce_state is not in SYNCABLE_KEYS', () => {
    expect(SYNCABLE_KEYS).not.toContain('integration_pkce_state');
  });

  it('no integration_consent_* prefix appears in SYNCABLE_KEYS', () => {
    for (const key of SYNCABLE_KEYS) {
      expect(key).not.toMatch(/^integration_consent_/);
    }
  });

  it('no integration_capabilities_* prefix appears in SYNCABLE_KEYS', () => {
    for (const key of SYNCABLE_KEYS) {
      expect(key).not.toMatch(/^integration_capabilities_/);
    }
  });

  it('no integration_reauth_required:* prefix appears in SYNCABLE_KEYS', () => {
    for (const key of SYNCABLE_KEYS) {
      expect(key).not.toMatch(/^integration_reauth_required:/);
    }
  });
});

describe('TOKEN-01 — delta-tracker bucket-level isolation (static grep)', () => {
  it('no integration_* key appears in delta-tracker ARRAY_KEYS or OBJECT_KEYS buckets', () => {
    const fs = require('fs');
    const path = require('path');
    const file = path.resolve(__dirname, '../delta-tracker.ts');
    const src = fs.readFileSync(file, 'utf-8');

    // Strip comments so doc-notes do not false-positive.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const arrayBucket = stripped.match(/ARRAY_KEYS\s*:\s*SyncableKey\[\]\s*=\s*\[[\s\S]*?\]/);
    const objectBucket = stripped.match(/OBJECT_KEYS\s*:\s*SyncableKey\[\]\s*=\s*\[[\s\S]*?\]/);

    const checkKeys = [...INTEGRATION_EXACT_KEYS, ...INTEGRATION_PREFIX_FAMILIES.map((p) => p.replace('_', '_'))];

    for (const key of checkKeys) {
      if (arrayBucket) {
        expect(arrayBucket[0]).not.toContain(`'${key}'`);
        expect(arrayBucket[0]).not.toContain(`"${key}"`);
      }
      if (objectBucket) {
        expect(objectBucket[0]).not.toContain(`'${key}'`);
        expect(objectBucket[0]).not.toContain(`"${key}"`);
      }
    }

    // Also verify the generic 'integration_' prefix is absent from both buckets
    if (arrayBucket) {
      expect(arrayBucket[0]).not.toMatch(/['"]integration_/);
    }
    if (objectBucket) {
      expect(objectBucket[0]).not.toMatch(/['"]integration_/);
    }
  });
});
