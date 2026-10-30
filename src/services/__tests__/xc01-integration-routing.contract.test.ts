/**
 * XC-01 integration-routing contract — adapter files MUST NOT call
 * chrome.storage.local.set or Storage.set directly.
 *
 * Currently vacuously passes (no adapter files yet — empty grep).
 * As 14-02..14-06 land real adapter files, this test will actively assert
 * the XC-01 contract: every adapter file MUST route all storage writes
 * through named service wrappers (integration-token-storage.ts,
 * integration-oauth-service.ts are the authorized write paths).
 *
 * Allowlist (exempt — these ARE the authorized storage-write service paths):
 *   - integration-token-storage.ts
 *   - integration-oauth-service.ts
 *
 * Mirrors Phase 13 xc01-service-routing.contract.test.ts pattern.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

// Allowlist: these files are the AUTHORIZED storage write paths
const ALLOWLIST_FILES = [
  'integration-token-storage.ts',
  'integration-oauth-service.ts',
];

// Forbidden patterns: direct storage access in adapter files
const FORBIDDEN_PATTERNS = [
  /chrome\.storage\.local\.set\s*\(/,
  /Storage\.set\s*\(/,
];

describe('XC-01 — integration adapters never write storage directly', () => {
  it('currently passes vacuously (no adapter files exist yet)', () => {
    // Find all adapter files under src/services/integrations/
    const adapterFiles = glob.sync(
      path.resolve(__dirname, '../../services/integrations/**/*.ts'),
      { nodir: true }
    ).filter((f) => {
      const basename = path.basename(f);
      // Exclude allowlist and placeholder
      return !ALLOWLIST_FILES.includes(basename) && !f.includes('__placeholder');
    });

    for (const file of adapterFiles) {
      const src = fs.readFileSync(file, 'utf-8');
      // Strip comments
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(stripped)) {
          throw new Error(
            `XC-01 violation: ${path.basename(file)} calls storage directly. ` +
            `Route through integration-token-storage.ts or integration-oauth-service.ts instead.`
          );
        }
      }
    }

    // Vacuously passes when no adapter files exist
    expect(adapterFiles.length).toBeGreaterThanOrEqual(0);
  });
});
