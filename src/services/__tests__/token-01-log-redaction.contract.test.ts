/**
 * TOKEN-01 log-redaction contract — RED stub (turns GREEN as adapter files land).
 *
 * When adapter files exist (14-02..14-06), asserts every console.log/warn/error
 * reference to access_token, refresh_token, bearer, or other sensitive fields
 * outside the allowlist files wraps via redactSecrets() or scoped destructuring.
 *
 * Allowlist (may reference access_token / refresh_token directly):
 *   - integration-token-storage.ts (owns token CRUD)
 *   - integration-oauth-service.ts (owns exchange/refresh)
 *
 * Mirrors MCP-19 log-redaction contract pattern.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

// Allowlist: these files are permitted to reference raw token strings
const ALLOWLIST = [
  'integration-token-storage.ts',
  'integration-oauth-service.ts',
];

// Sensitive patterns to check for in non-allowlist files
const SENSITIVE_PATTERN =
  /console\.(log|warn|error|debug)\s*\([^;\n]*(access_token|refresh_token|accessToken|refreshToken|bearer|token:)/i;

describe('TOKEN-01 — integration adapter log-redaction contract', () => {
  it('adapter files do not log token-bearing fields or bearer values', () => {
    // Find all adapter files in src/services/integrations/**/*.ts
    const adapterFiles = glob.sync(
      path.resolve(__dirname, '../../services/integrations/**/*.ts'),
      { nodir: true }
    ).filter((f) => {
      const basename = path.basename(f);
      return !ALLOWLIST.includes(basename) && !f.includes('__placeholder');
    });

    // No adapter files exist yet — vacuously true
    for (const file of adapterFiles) {
      const src = fs.readFileSync(file, 'utf-8');
      // Strip comments
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(stripped).not.toMatch(SENSITIVE_PATTERN);
    }

    expect(adapterFiles.length).toBeGreaterThan(0);
  });
});
