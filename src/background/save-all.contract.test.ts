import * as fs from 'fs';
import * as path from 'path';

const SERVICE_WORKER_FILE = path.resolve(__dirname, 'service-worker.ts');
const source = fs.readFileSync(SERVICE_WORKER_FILE, 'utf-8');

describe('background save-all contract', () => {
  it('routes background save-all entry points through the shared current-window helper', () => {
    expect(source).toContain('saveCurrentWindowTabs');
    expect(source).toContain("const result = await saveCurrentWindowTabs({ now: Date.now() });");
    expect(source).toContain("const result = await saveCurrentWindowTabs({ now: Date.now(), projectId });");
  });

  it('keeps command, context menu, and floating button save-all paths pointed at saveAllTabs', () => {
    expect(source).toContain("case 'save-all-tabs':");
    expect(source).toContain("case 'save-all-tabs-page':");
    expect(source).toContain("case 'save-all-tabs-link':");
    expect(source).toContain("if (message.type === 'FLOATING_BUTTON_SAVE_ALL_TABS')");
  });
});
