import * as fs from 'fs';
import * as path from 'path';

const OPTIONS_MAIN_FILE = path.resolve(__dirname, 'main.tsx');
const source = fs.readFileSync(OPTIONS_MAIN_FILE, 'utf-8');

describe('options save-all contract', () => {
  it('delegates manual save-all through the shared current-window helper so every save entry point preserves the same pipeline', () => {
    expect(source).toContain("from '../services/save-current-window-tabs';");
    expect(source).toContain('saveCurrentWindowTabs');
    expect(source).toContain('const result = await saveCurrentWindowTabs({');
  });

  it('routes fast-action suspended saves through the shared suspended helper', () => {
    expect(source).toContain('saveSuspendedTabsFromCurrentWindow');
    expect(source).toContain('const result = await saveSuspendedTabsFromCurrentWindow({');
  });
});
