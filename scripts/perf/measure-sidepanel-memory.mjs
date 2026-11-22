#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = resolve(process.argv[2] || join(projectRoot, 'dist'));
const playwrightPath = process.env.PLAYWRIGHT_CORE;
const chromiumPath = process.env.CHROMIUM_PATH;
if (!playwrightPath || !chromiumPath) {
  throw new Error('Set PLAYWRIGHT_CORE to the installed playwright-core directory (or entry file), and CHROMIUM_PATH to a Chromium executable.');
}
const { chromium } = require(resolve(playwrightPath));
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
if (!manifest.background?.service_worker || !manifest.side_panel?.default_path) {
  throw new Error('Use the Chrome build (npm run build), with a service worker and side panel.');
}

// Fixed IDs, titles, URLs, timestamps, grouping and expansion state. These are
// saved records, not 100 network-backed live browser tabs.
const timestamp = 1_767_225_600_000;
const groups = Array.from({ length: 10 }, (_, groupIndex) => {
  const id = `memory-group-${groupIndex + 1}`;
  return {
    id, name: `Memory fixture group ${String(groupIndex + 1).padStart(2, '0')}`,
    created: timestamp, modified: timestamp,
    tabs: Array.from({ length: 10 }, (_, tabIndex) => {
      const number = groupIndex * 10 + tabIndex + 1;
      return {
        id: `memory-tab-${number}`, groupId: id, timestamp,
        title: `Memory fixture tab ${String(number).padStart(3, '0')}`,
        url: `https://example.com/memory-fixture/${number}`,
        // No remote favicons: avoid incidental network or cache differences.
        favicon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      };
    }),
  };
});

const profile = await mkdtemp(join(tmpdir(), 'bluetab-memory-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: resolve(chromiumPath),
    headless: process.env.HEADLESS === '1',
    viewport: { width: 400, height: 900 },
    locale: 'en-US', timezoneId: 'UTC',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run', '--no-default-browser-check',
    ],
  });
  context.setDefaultTimeout(30_000);
  // Routes prevent page-origin network noise; service workers are not covered
  // by Playwright routing, so the fresh fixture has no account or feeds.
  await context.route(/^https?:\/\//, (route) => route.abort());
  const isExtensionWorker = (worker) => worker.url().startsWith('chrome-extension://')
    && worker.url().endsWith(manifest.background.service_worker);
  const worker = context.serviceWorkers().find(isExtensionWorker)
    || await context.waitForEvent('serviceworker', { predicate: isExtensionWorker, timeout: 30_000 });
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(async (fixture) => {
    await chrome.storage.local.set({
      groups: fixture,
      projects: [], tags: [], rssFeeds: [],
      sidepanelActiveTab: 'groups',
      settings: { language: 'en', theme: 'light', autoArchiveInactiveGroups: false, floatingButtonEnabled: false },
      adhd_settings: { masterEnabled: false },
      onboarding_state: { completed: true },
      collapsedGroups: Object.fromEntries(fixture.map((group) => [group.id, false])),
    });
  }, groups);

  const page = await context.newPage();
  // Close startup/onboarding tabs, keeping one deterministic live tab.
  for (const other of context.pages()) if (other !== page) await other.close();
  await page.goto(`chrome-extension://${extensionId}/${manifest.side_panel.default_path}`, { waitUntil: 'load' });
  // The persisted Groups tab must be mounted and all 100 saved rows rendered.
  // This avoids measuring a spinner, the default live-tabs pane, or a crash UI.
  await page.waitForFunction(() => {
    const panel = document.querySelector('[role="tabpanel"][data-state="active"]');
    if (!panel) return false;
    const labels = [...panel.querySelectorAll('bdi')].map((node) => node.textContent);
    return labels.filter((text) => /^Memory fixture tab \d{3}$/.test(text || '')).length === 100;
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // Let the known stagger/expand animations and debounced storage work finish.
  await page.waitForTimeout(1500);
  const count = await page.evaluate(async () => {
    const { groups: saved } = await chrome.storage.local.get('groups');
    return saved.reduce((sum, group) => sum + group.tabs.length, 0);
  });
  if (count !== 100) throw new Error(`Fixture changed: expected 100 saved tabs, found ${count}`);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  console.log(JSON.stringify({
    extensionVersion: manifest.version,
    chromiumVersion: context.browser()?.version() ?? 'unknown',
    fixture: '10 groups / 100 saved tabs, expanded, English, 400x900',
    usedJSHeapBytes: heap.usedSize,
    usedJSHeapMiB: Number((heap.usedSize / 1024 / 1024).toFixed(3)),
    totalJSHeapBytes: heap.totalSize,
    embedderHeapUsedBytes: heap.embedderHeapUsedSize ?? null,
    backingStorageBytes: heap.backingStorageSize ?? null,
  }, null, 2));
  await cdp.detach();
} finally {
  try { await context?.close(); }
  finally { await rm(profile, { recursive: true, force: true }); }
}
