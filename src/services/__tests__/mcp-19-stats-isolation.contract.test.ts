/**
 * MCP-19 stats-isolation contract — stats-service.ts NEVER serializes
 * MCP credentials, endpoint URLs, or authHeader strings.
 *
 * GREEN ON LANDING in Plan 13-01. Static grep against the stats-service
 * source: the words `mcp_client_endpoints` and `authHeader` MUST NOT
 * appear, full stop. If a future PR adds an MCP-related metric to
 * StatsService, this test fails until the metric is named without
 * leaking credentials.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('MCP-19 — StatsService never serializes MCP credentials', () => {
  it('stats-service.ts contains no reference to mcp_client_endpoints or authHeader', () => {
    const file = path.resolve(__dirname, '../stats-service.ts');
    const src = fs.readFileSync(file, 'utf-8');

    // Strip comments first so doc-notes mentioning the keys (if any)
    // do not false-positive.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(stripped).not.toMatch(/mcp_client_endpoints/);
    expect(stripped).not.toMatch(/authHeader/i);
  });
});
