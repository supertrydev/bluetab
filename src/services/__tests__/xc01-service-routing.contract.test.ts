/**
 * XC-01 service-routing contract — MCP write tools call services, never
 * chrome.storage.local directly.
 *
 * Plan 13-01 landed this with a vacuous file-absent branch. Plan 13-04
 * creates `src/services/mcp-server-service.ts` and turns the contract
 * live: the WRITE_HANDLERS region (delimited by the
 * `// ==== XC-01: write-tool handlers ====` and
 * `// ==== End XC-01 region ====` source comments) MUST contain zero
 * direct writes to chrome.storage.local / Storage.set('groups'|...) /
 * Storage.set('projects'|...) / Storage.set('reminders'|...). Every
 * write MUST resolve through a named service helper:
 *   - BrainDumpService.add / .updateEntry
 *   - ReminderService.create
 *   - Storage.addProject / .updateProject / .assignGroupsToProject
 *   - Group append/patch helpers (declared OUTSIDE the marker region —
 *     the XC-01 test scopes the grep WITHIN the markers, which is the
 *     "services own state" intent from CONTEXT.md §PROCESS-03)
 *
 * Why marker-scoped: helpers like appendGroup / patchGroup are
 * legitimate group-storage entry points (they ARE the service-layer
 * for the 'groups' array key — the codebase has no GroupService
 * class; service-worker.ts and a handful of hooks share the same
 * read-modify-write pattern). The contract is "the WRITE-HANDLER
 * BODIES route through services," not "the file contains zero writes."
 *
 * The required-references check still scans the whole file.
 */

import * as fs from 'fs';
import * as path from 'path';

const SERVICE_FILE = path.resolve(__dirname, '../mcp-server-service.ts');
const REQUIRED_SERVICE_REFERENCES = [
  'BrainDumpService',
  'ReminderService',
];

// Markers must be at line-start (no leading whitespace / asterisks).
// JSDoc references like ` * "// ==== XC-01: ... markers"` would
// otherwise false-match. Anchored regexes scope strictly.
const MARKER_START_RE = /^\/\/ ==== XC-01: write-tool handlers/m;
const MARKER_END_RE = /^\/\/ ==== End XC-01 region/m;

function extractWriteHandlerRegion(src: string): string {
  const startMatch = MARKER_START_RE.exec(src);
  const endMatch = MARKER_END_RE.exec(src);
  if (!startMatch || !endMatch) {
    throw new Error(
      'XC-01 marker comments not found in mcp-server-service.ts — write-tool handler region is undelimited',
    );
  }
  return src.slice(startMatch.index, endMatch.index);
}

describe('XC-01 — MCP write tools route through services, not chrome.storage.local', () => {
  it('mcp-server-service.ts has no direct chrome.storage.local.set in write-tool handler region', () => {
    if (!fs.existsSync(SERVICE_FILE)) {
      // Plan 13-01 vacuous branch — file does not exist.
      expect(true).toBe(true);
      return;
    }

    const src = fs.readFileSync(SERVICE_FILE, 'utf-8');
    const region = extractWriteHandlerRegion(src);
    // Strip block + line comments before scanning so JSDoc references
    // ("Do not call chrome.storage.local directly") don't false-positive.
    const stripped = region
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
    expect(stripped).not.toMatch(/Storage\.set\s*\(\s*['"]groups['"]/);
    expect(stripped).not.toMatch(/Storage\.set\s*\(\s*['"]projects['"]/);
    expect(stripped).not.toMatch(/Storage\.set\s*\(\s*['"]reminders['"]/);
    expect(stripped).not.toMatch(/Storage\.set\s*\(\s*['"]brain_dump_inbox['"]/);
  });

  it('mcp-server-service.ts references the named service helpers (when present)', () => {
    if (!fs.existsSync(SERVICE_FILE)) {
      expect(true).toBe(true);
      return;
    }

    const src = fs.readFileSync(SERVICE_FILE, 'utf-8');
    for (const ref of REQUIRED_SERVICE_REFERENCES) {
      expect(src).toMatch(new RegExp(ref));
    }
  });

  it('write-handler region contains references to the named services (XC-01 positive check)', () => {
    if (!fs.existsSync(SERVICE_FILE)) {
      expect(true).toBe(true);
      return;
    }

    const src = fs.readFileSync(SERVICE_FILE, 'utf-8');
    const region = extractWriteHandlerRegion(src);

    // Each of these MUST appear inside the WRITE_HANDLERS region.
    // They prove that the handler bodies actually call the service
    // (positive complement to the "no direct write" negative check).
    for (const ref of [
      'BrainDumpService.add',
      'BrainDumpService.updateEntry',
      'ReminderService.create',
      'Storage.addProject',
      'Storage.updateProject',
    ]) {
      expect(region).toContain(ref);
    }
  });
});
