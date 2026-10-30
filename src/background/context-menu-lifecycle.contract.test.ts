import * as fs from 'fs';
import * as path from 'path';

const SERVICE_WORKER_FILE = path.resolve(__dirname, 'service-worker.ts');
const source = fs.readFileSync(SERVICE_WORKER_FILE, 'utf-8');

describe('background context-menu lifecycle contract', () => {
  it('rebuilds context menus on startup as well as install', () => {
    expect(source).toMatch(/onStartup[\s\S]*createContextMenus\(/);
    expect(source).toMatch(/onInstalled[\s\S]*createContextMenus\(/);
  });

  it('serializes overlapping context menu rebuild requests', () => {
    expect(source).toContain('let contextMenuRebuildPromise: Promise<boolean> | null = null;');
    expect(source).toContain('let contextMenuRebuildRequested = false;');
    expect(source).toContain('while (contextMenuRebuildRequested)');
  });

  it('retries failed rebuilds and only marks bootstrap complete after success', () => {
    expect(source).toContain('for (let attempt = 1; attempt <= 2; attempt += 1)');
    expect(source).toContain("const rebuilt = await createContextMenus('worker-session-bootstrap');");
    expect(source).toContain('if (!rebuilt) return;');
    expect(source).toContain('chrome.storage.session?.remove(CONTEXT_MENU_BOOTSTRAP_SESSION_KEY)');
  });

  it('checks runtime.lastError while creating context menu items', () => {
    expect(source).toContain('chrome.contextMenus.create(props, () => {');
    expect(source).toContain('const error = chrome.runtime.lastError;');
  });

  it('keeps existing-group menus shallow to avoid oversized menu trees', () => {
    expect(source).toContain('function getSafeContextMenuGroupLimit(value: number | undefined): number {');
    expect(source).not.toContain("parentId: `group-${group.id}`");
    expect(source).not.toContain("parentId: `group-link-${group.id}`");
  });

  it('bootstraps context menus once per browser session when the worker starts', () => {
    expect(source).toContain("const CONTEXT_MENU_BOOTSTRAP_SESSION_KEY = 'context_menu_bootstrapped_at';");
    expect(source).toContain("await createContextMenus('worker-session-bootstrap');");
    expect(source).toContain('void maybeBootstrapContextMenusOnWorkerStart();');
  });
});
