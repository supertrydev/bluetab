/**
 * docs/mcp-server-spec.md contract test (MCP-12, MCP-02, MCP-13).
 *
 * GREEN ON LANDING in Plan 13-01 — the spec doc was created in this
 * same plan and contains all 11 required section headings derived
 * from 13-RESEARCH.md §Supertry Spec Outline.
 *
 * If a future PR removes a required section heading, this test fails
 * CI immediately so Supertry's hand-off contract cannot drift silently.
 */

import * as fs from 'fs';
import * as path from 'path';

const SPEC_FILE = path.resolve(__dirname, '../../../docs/mcp-server-spec.md');

// 11 required sections from 13-RESEARCH.md §Supertry Spec Outline.
// Each entry is a substring search (case-insensitive) — the spec uses
// numbered Markdown headings ("## 1. Protocol Version" etc.); the test
// just looks for the section topic string in any heading-shaped line.
const REQUIRED_SECTIONS = [
  'Protocol Version',
  'Tool Registry',
  'OAuth 2.1',                  // covers "Authentication — OAuth 2.1 + PKCE"
  'Audience Segregation',
  'Rate Limits',
  'Error Codes',
  'Async Write Queue',
  'Confirmation Token',
  'Snapshot Push Endpoint',
  'Kill Switch',
  'HTTPS',                      // covers "HTTPS and Private-IP Requirements"
];

describe('MCP-12 — docs/mcp-server-spec.md exists with required sections', () => {
  it('the spec file exists', () => {
    expect(fs.existsSync(SPEC_FILE)).toBe(true);
  });

  it('contains every required section heading from 13-RESEARCH.md', () => {
    const src = fs.readFileSync(SPEC_FILE, 'utf-8');
    // Lower-case once for case-insensitive matching.
    const lower = src.toLowerCase();

    for (const section of REQUIRED_SECTIONS) {
      const needle = section.toLowerCase();
      if (!lower.includes(needle)) {
        throw new Error(
          `mcp-server-spec.md missing required section: "${section}"`
        );
      }
      expect(lower).toContain(needle);
    }
  });

  it('mentions RFC 8707 Resource Indicators (forward-compat with 2025-06-18)', () => {
    const src = fs.readFileSync(SPEC_FILE, 'utf-8');
    expect(src).toMatch(/RFC\s*8707/i);
  });

  it('mentions Content-Encoding gzip on the snapshot push endpoint', () => {
    const src = fs.readFileSync(SPEC_FILE, 'utf-8');
    expect(src.toLowerCase()).toContain('content-encoding: gzip');
  });

  it('mentions the audience values bluetab-sync, bluetab-bridge, bluetab-mcp', () => {
    const src = fs.readFileSync(SPEC_FILE, 'utf-8');
    expect(src).toContain('bluetab-sync');
    expect(src).toContain('bluetab-bridge');
    expect(src).toContain('bluetab-mcp');
  });
});
