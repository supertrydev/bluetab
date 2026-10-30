/**
 * TOKEN-01 stats-isolation contract — stats-service.ts MUST NOT serialize
 * integration tokens, token storage keys, or raw access/refresh token strings.
 *
 * GREEN ON LANDING in Plan 14-01. Mirrors MCP-19 stats-isolation pattern.
 * Static grep against stats-service.ts: the sensitive strings must be absent.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('TOKEN-01 — StatsService never serializes integration credentials', () => {
  it('stats-service.ts contains no reference to integration_tokens or integration_settings', () => {
    const file = path.resolve(__dirname, '../stats-service.ts');
    const src = fs.readFileSync(file, 'utf-8');

    // Strip comments first so doc-notes do not false-positive.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(stripped).not.toMatch(/integration_tokens/);
    expect(stripped).not.toMatch(/integration_settings/);
  });

  it('stats-service.ts contains no reference to access_token or refresh_token', () => {
    const file = path.resolve(__dirname, '../stats-service.ts');
    const src = fs.readFileSync(file, 'utf-8');

    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(stripped).not.toMatch(/\baccess_token\b/i);
    expect(stripped).not.toMatch(/\brefresh_token\b/i);
  });
});
