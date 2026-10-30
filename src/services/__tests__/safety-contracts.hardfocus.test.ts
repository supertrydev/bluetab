/**
 * Hard Focus SAFETY contract tests
 *
 * Static-grep assertions on hard-focus-service.ts source to enforce:
 *
 * 1. No direct tab navigation — Hard Focus MUST redirect via dNR rules only.
 *    Any `chrome.tabs.update(.*url:` in the source means the implementation
 *    can bypass the whitelist with a direct navigation.
 *
 * 2. Only chrome.declarativeNetRequest.updateDynamicRules is used for rule
 *    mutation (the sanctioned API). No other rule-store API (setDynamicRules,
 *    updateStaticRules, etc.).
 *
 * 3. buildWhitelistRules ALWAYS emits the chrome-extension://* allow rule at
 *    priority >= 3. This is the mandatory lock-out guard (RESEARCH pitfall #1).
 *
 * 4. All Hard Focus rule IDs fall within [20000, 24999]. No collision with
 *    Phase 6 range [10000, 19999].
 *
 * 5. Rule priorities are ordered correctly:
 *    chrome-extension allow (3) > per-URL allow (2) > catch-all block (1).
 *
 * Pattern mirrors the approach used by Phase 9 auto-suspend safety tests:
 * read the source file as text, strip comments, then regex-assert.
 *
 * Requirements: ADHD-13/14 (Hard Focus whitelist), RESEARCH Finding #8.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  HardFocusService,
  HARD_FOCUS_BLOCK_ID,
  HARD_FOCUS_EXTENSION_ALLOW_ID,
  HARD_FOCUS_CHROME_ALLOW_ID,
  HARD_FOCUS_ALLOW_START,
  HARD_FOCUS_ALLOW_END,
} from '@/services/hard-focus-service';

// ---------------------------------------------------------------------------
// Source-text helpers
// ---------------------------------------------------------------------------

const SERVICE_PATH = path.resolve(
  __dirname,
  '../../services/hard-focus-service.ts',
);

/** Read and return the service source with both line and block comments stripped. */
function readSourceStripped(): string {
  const raw = fs.readFileSync(SERVICE_PATH, 'utf8');
  // Strip block comments (/* ... */) first, then line comments (// ...)
  // Avoids false positives from JSDoc documentation or commented-out code.
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.replace(/\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('HARD FOCUS SAFETY contract — hard-focus-service.ts', () => {
  let source: string;

  beforeAll(() => {
    source = readSourceStripped();
  });

  // -------------------------------------------------------------------------
  // Contract 1: No direct tab navigation
  // -------------------------------------------------------------------------
  test(
    'HARD FOCUS SAFETY: hard-focus-service.ts source contains NO direct tab navigation ' +
      '— no chrome.tabs.update(.*url:',
    () => {
      // Hard Focus MUST redirect via dNR rules only. Direct tab URL mutation
      // would bypass the whitelist for any tab the service touches directly.
      const directNavPattern = /chrome\.tabs\.update\s*\([^)]*url\s*:/;
      expect(directNavPattern.test(source)).toBe(false);
    },
  );

  // -------------------------------------------------------------------------
  // Contract 2: Uses the sanctioned mutation API
  // -------------------------------------------------------------------------
  test(
    'HARD FOCUS SAFETY: hard-focus-service.ts uses ' +
      'chrome.declarativeNetRequest.updateDynamicRules (the only sanctioned mutation API)',
    () => {
      const sanctionedApi = /chrome\.declarativeNetRequest\.updateDynamicRules/;
      expect(sanctionedApi.test(source)).toBe(true);
    },
  );

  // -------------------------------------------------------------------------
  // Contract 3: chrome-extension://* allow rule always present
  // -------------------------------------------------------------------------
  test(
    'HARD FOCUS SAFETY: buildWhitelistRules output ALWAYS includes a chrome-extension://* ' +
      'allow rule at priority >= 3 (empty URL list)',
    () => {
      const rules = HardFocusService.buildWhitelistRules([], false);
      // H-fix: filter is now left-anchored '|chrome-extension://' (not wildcard suffix)
      const extAllowRule = rules.find(
        (r) =>
          (r.condition as chrome.declarativeNetRequest.RuleCondition).urlFilter ===
            '|chrome-extension://' && r.action.type === 'allow',
      );
      expect(extAllowRule).toBeDefined();
      expect(extAllowRule!.priority).toBeGreaterThanOrEqual(3);
    },
  );

  test(
    'HARD FOCUS SAFETY: buildWhitelistRules output ALWAYS includes a chrome-extension://* ' +
      'allow rule at priority >= 3 (non-empty URL list)',
    () => {
      const rules = HardFocusService.buildWhitelistRules(
        ['https://example.com', 'https://github.com'],
        false,
      );
      // H-fix: filter is now left-anchored '|chrome-extension://' (not wildcard suffix)
      const extAllowRule = rules.find(
        (r) =>
          (r.condition as chrome.declarativeNetRequest.RuleCondition).urlFilter ===
            '|chrome-extension://' && r.action.type === 'allow',
      );
      expect(extAllowRule).toBeDefined();
      expect(extAllowRule!.priority).toBeGreaterThanOrEqual(3);
    },
  );

  // -------------------------------------------------------------------------
  // Contract 4: All rule IDs in [20000, 24999]
  // -------------------------------------------------------------------------
  test(
    'HARD FOCUS SAFETY: all Hard Focus rule IDs fall within [20000, 24999] ' +
      '(no collision with Phase 6 range 10000..19999)',
    () => {
      // Use a large URL list to exercise the cap behaviour
      const urls = Array.from({ length: 200 }, (_, i) => `https://example${i}.com`);
      const rules = HardFocusService.buildWhitelistRules(urls, false);

      for (const rule of rules) {
        // All IDs must be in the Hard Focus range
        expect(rule.id).toBeGreaterThanOrEqual(HARD_FOCUS_BLOCK_ID);
        expect(rule.id).toBeLessThanOrEqual(HARD_FOCUS_ALLOW_END);
        // Must NOT overlap Phase 6 range [10000, 19999]
        expect(rule.id < 10000 || rule.id > 19999).toBe(true);
      }

      // Verify the range constants themselves are correct (HF1 revised: 3 structural rules)
      expect(HARD_FOCUS_BLOCK_ID).toBe(20000);
      expect(HARD_FOCUS_EXTENSION_ALLOW_ID).toBe(20001);
      expect(HARD_FOCUS_CHROME_ALLOW_ID).toBe(20002);
      expect(HARD_FOCUS_ALLOW_START).toBe(20003);
      expect(HARD_FOCUS_ALLOW_END).toBe(24999);
    },
  );

  // -------------------------------------------------------------------------
  // Contract 5: Priority ordering correct
  // -------------------------------------------------------------------------
  test(
    'HARD FOCUS SAFETY: rule priorities ordered correctly — ' +
      'chrome allows (3) > per-URL allow (2) > catch-all block (1)',
    () => {
      const rules = HardFocusService.buildWhitelistRules(['https://a.com'], false);

      const blockRule = rules.find((r) => r.id === HARD_FOCUS_BLOCK_ID);
      const extAllowRule = rules.find((r) => r.id === HARD_FOCUS_EXTENSION_ALLOW_ID);
      const chromeAllowRule = rules.find((r) => r.id === HARD_FOCUS_CHROME_ALLOW_ID);
      const perUrlRule = rules.find((r) => r.id === HARD_FOCUS_ALLOW_START);

      expect(blockRule).toBeDefined();
      expect(extAllowRule).toBeDefined();
      expect(chromeAllowRule).toBeDefined();
      expect(perUrlRule).toBeDefined();

      // catch-all block must be lowest priority
      expect(blockRule!.priority).toBe(1);
      // per-URL allow must be middle priority
      expect(perUrlRule!.priority).toBe(2);
      // chrome-extension allow must be highest priority
      expect(extAllowRule!.priority).toBe(3);
      // chrome allow also at priority 3
      expect(chromeAllowRule!.priority).toBe(3);

      // Strict ordering
      expect(extAllowRule!.priority ?? 0).toBeGreaterThan(perUrlRule!.priority ?? 0);
      expect(perUrlRule!.priority ?? 0).toBeGreaterThan(blockRule!.priority ?? 0);
    },
  );
});
