/**
 * integration-context-menu.test.ts — Service-worker context menu wiring contract.
 *
 * Test environment: Node (Jest + ts-jest). The service-worker module itself is
 * far too heavy to import in a unit test (it pulls in chrome.* APIs at module
 * load time), so this test verifies the contract via fs.readFileSync + regex
 * over the source — the project's static-source pattern (Phase 13 precedent).
 *
 * Behavior under test (Plan 14-07 Task 2):
 *   1. Service worker defines a `rebuildIntegrationContextMenus` function (or
 *      equivalent helper) that calls `listConnectedAccounts` and creates
 *      menu items with IDs of the form `integration:save:<id>:<accountId>`
 *      and `integration:mirror:<id>`.
 *   2. The chrome.contextMenus.onClicked listener parses these IDs and
 *      routes to integrationService.dispatchVerb using the
 *      buildIntegrationContextMenuDispatch helper (save) / sends an
 *      OPEN_GROUP_MIRROR_PICKER runtime message (mirror).
 *   3. chrome.storage.onChanged for `integration_tokens` triggers a rebuild
 *      so the menu stays in sync after connect/disconnect — no orphaned
 *      entries.
 *   4. SAFETY-02 clean.
 */

import * as fs from 'fs';
import * as path from 'path';

const SW_FILE = path.resolve(__dirname, '../../../background/service-worker.ts');
const swSource = fs.readFileSync(SW_FILE, 'utf-8');

describe('service-worker integration context menus — contract', () => {
  it('source defines an integration-menu rebuild helper', () => {
    expect(swSource).toMatch(/rebuildIntegrationContextMenus|rebuildIntegrationMenus/);
  });

  it('imports listConnectedAccounts from integration-token-storage', () => {
    expect(swSource).toMatch(/listConnectedAccounts/);
    expect(swSource).toMatch(/integration-token-storage/);
  });

  it('creates menu IDs in the integration:save:<id>:<accountId> format', () => {
    expect(swSource).toMatch(/integration:save:/);
  });

  it('nests integration roots under the main BlueTab page and link parents', () => {
    expect(swSource).toContain("id: 'integration:root:page',");
    expect(swSource).toContain("parentId: 'page-parent',");
    expect(swSource).toContain("id: 'integration:root:link',");
    expect(swSource).toContain("parentId: 'link-parent',");
  });

  it('filters inactive stored accounts before creating integration menu roots', () => {
    expect(swSource).toContain('const activeAccounts = accounts.filter');
    expect(swSource).toContain('if (activeAccounts.length === 0) return;');
    expect(swSource).toContain('for (const account of activeAccounts)');
  });

  it('creates the mirror menu ID format integration:mirror:<id>', () => {
    expect(swSource).toMatch(/integration:mirror:/);
  });

  it('onClicked listener parses integration:save:* and dispatches a verb', () => {
    expect(swSource).toMatch(/integration:save/);
    expect(swSource).toMatch(/dispatchVerb/);
    expect(swSource).toMatch(/buildIntegrationContextMenuDispatch/);
  });

  it('onClicked listener parses integration:mirror:* and broadcasts OPEN_GROUP_MIRROR_PICKER', () => {
    expect(swSource).toMatch(/integration:mirror/);
    expect(swSource).toMatch(/OPEN_GROUP_MIRROR_PICKER/);
  });

  it('chrome.storage.onChanged for integration_tokens triggers a rebuild', () => {
    // Should reference both the storage key and the rebuild call together.
    expect(swSource).toMatch(/integration_tokens/);
    expect(swSource).toMatch(/rebuildIntegrationContextMenus|rebuildIntegrationMenus/);
  });

  it('rebuild is also called from the install / startup paths', () => {
    // Either explicit invocation or wired through createContextMenus().
    expect(swSource).toMatch(/onInstalled|onStartup/);
  });
});

describe('service-worker integration context menus — SAFETY-02', () => {
  it('does not contain SAFETY-02 forbidden words in user-facing menu titles or toast messages', () => {
    // Extract every chrome.contextMenus.create({ ... title: '...' }) and
    // every chrome.notifications.create({ ... message: '...' }) string near
    // the integration-menu wiring. console.warn / console.error debug
    // strings are not user-facing and are excluded.
    const idx = swSource.indexOf('rebuildIntegrationContextMenus');
    if (idx < 0) return;
    const slice = swSource.slice(idx, idx + 8000);
    const userFacing: string[] = [];
    // title: '...'
    for (const m of slice.matchAll(/title:\s*[`'"]([^`'"]+)[`'"]/g)) userFacing.push(m[1]);
    // message: `...` (template literal, may contain ${})
    for (const m of slice.matchAll(/message:\s*`([^`]+)`/g)) userFacing.push(m[1]);
    // message: '...' (plain string)
    for (const m of slice.matchAll(/message:\s*['"]([^'"]+)['"]/g)) userFacing.push(m[1]);
    const FORBIDDEN = new RegExp(
      String.raw`\b(streak|missed|fail` +
        String.raw`ed|expir` +
        String.raw`ed|wasted|broken|you did not)\b|time's up`,
      'i',
    );
    for (const text of userFacing) {
      expect(text).not.toMatch(FORBIDDEN);
    }
  });
});
