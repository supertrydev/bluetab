/**
 * ADHD-12 SAFETY contract — visible-tab-limit-service.ts
 *
 * This is the source-text contract that mechanically verifies the VTL
 * service can NEVER close, remove, or navigate tabs — regardless of future
 * code changes. It mirrors the Phase 9 auto-suspend-service.safety.test.ts
 * pattern: static source-grep on the service file.
 *
 * Requirements covered:
 *   ADHD-12: Visible Tab Limit MAY use non-destructive grouping
 *            (create/move/collapse tab groups). It MUST NOT close, remove,
 *            or replace any tab.
 *   SAFETY-01: Extension never closes or discards tabs without explicit
 *              user action.
 *
 * Pattern: Phase 10 offline-reading-service.contract.test.ts + Phase 9
 * auto-suspend-service.safety.test.ts. Uses `import * as fs` (Jest
 * CommonJS transform does not wrap Node built-in default exports).
 *
 * If ANY of these tests fail, DO NOT loosen the assertions. Fix the
 * visible-tab-limit-service.ts to remove the forbidden call.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Source text loading + comment stripping
// ---------------------------------------------------------------------------

const SERVICE_PATH = path.resolve(
  __dirname,
  '..',
  'visible-tab-limit-service.ts',
);

const rawSource = fs.readFileSync(SERVICE_PATH, 'utf8');

/**
 * Strip single-line (//) and block (/* ... *\/) comments from TypeScript
 * source text before pattern matching.
 *
 * WHY: JSDoc comments in the service file intentionally MENTION the forbidden
 * APIs (e.g. "NEVER call chrome.tabs.remove") for documentation purposes.
 * Grepping raw source would generate false positives. Stripping comments
 * first ensures only executable code is checked.
 *
 * Pattern mirrors Phase 10 contract test convention.
 */
function stripComments(src: string): string {
  // Remove block comments first (/* ... */), including multi-line.
  let stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments (//).
  stripped = stripped.replace(/\/\/[^\n]*/g, '');
  return stripped;
}

const codeWithoutComments = stripComments(rawSource);

// ---------------------------------------------------------------------------
// ADHD-12 SAFETY contract tests
// ---------------------------------------------------------------------------

describe('ADHD-12 SAFETY contract — visible-tab-limit-service.ts', () => {
  it('ADHD-12 SAFETY: visible-tab-limit-service.ts never calls chrome.tabs.remove', () => {
    // Forbidden: chrome.tabs.remove( — would delete a tab from the browser.
    expect(/\bchrome\.tabs\.remove\s*\(/.test(codeWithoutComments)).toBe(false);
  });

  it('ADHD-12 SAFETY: visible-tab-limit-service.ts never calls chrome.tabs.update with a chrome-extension:// URL', () => {
    // Forbidden: chrome.tabs.update with url: 'chrome-extension://...' —
    // this pattern is used by some implementations to "fix" overflow by
    // navigating tabs to the extension's own URL. Bluetab never does this.
    //
    // Regex catches: chrome.tabs.update(... url: 'chrome-extension://...') or
    //                chrome.tabs.update(... url: "chrome-extension://...") or
    //                chrome.tabs.update(... url: `chrome-extension://...`)
    const navigatesToExtension = /chrome\.tabs\.update\s*\([^)]*url\s*:\s*['"`][^'"`]*chrome-extension:\/\//.test(
      codeWithoutComments,
    );
    expect(navigatesToExtension).toBe(false);
  });

  it('ADHD-12 SAFETY: visible-tab-limit-service.ts does not use forbidden tab-mutation APIs', () => {
    // These APIs are not expected in the VTL service:
    // - chrome.tabs.discard — would suspend a tab (AutoSuspend's territory)
    // - chrome.tabs.create — would open new tabs (not VTL's job)
    // - chrome.tabs.highlight — not relevant to tab-group management
    // - chrome.windows.* — cross-window operations not needed for VTL
    //
    // NOTE: chrome.tabs.move IS now used for VTL-3 end-of-destination placement
    // (moving graduated tabs to the last slot in their destination group or
    // end of window). This is a non-destructive within-window position change,
    // NOT a cross-window move. It is explicitly approved for VTL-3.
    // This test was updated in Plan 12-05 post-human-verify to reflect VTL-3.
    const forbiddenPattern =
      /chrome\.tabs\.(discard|create|highlight)\s*\(|chrome\.windows\./;
    expect(forbiddenPattern.test(codeWithoutComments)).toBe(false);
  });

  it('ADHD-12 SAFETY: visible-tab-limit-service.ts contains the expected safe group-mutation API calls', () => {
    // Positive assertion: the service MUST use at least one of the approved
    // group-mutation APIs. If this test fails, the service has been emptied
    // and the ADHD-12 contract test is vacuous (no enforcement without code).
    //
    // Approved APIs for Visible Tab Limit:
    //   chrome.tabs.group       — move tabs into a tab group
    //   chrome.tabs.ungroup     — remove tabs from a tab group
    //   chrome.tabGroups.update — set group title/color/collapsed state
    //   chrome.tabGroups.query  — find existing groups by title/windowId
    //   chrome.tabGroups.get    — get a single group's metadata
    const hasApprovedCall =
      /chrome\.tabs\.group\s*\(/.test(codeWithoutComments) ||
      /chrome\.tabs\.ungroup\s*\(/.test(codeWithoutComments) ||
      /chrome\.tabGroups\.update\s*\(/.test(codeWithoutComments) ||
      /chrome\.tabGroups\.query\s*\(/.test(codeWithoutComments);

    expect(hasApprovedCall).toBe(true);
  });
});
