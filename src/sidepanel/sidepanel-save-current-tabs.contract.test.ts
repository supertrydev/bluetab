import * as fs from 'fs';
import * as path from 'path';

const SIDEPANEL_MAIN_FILE = path.resolve(__dirname, 'main.tsx');
const source = fs.readFileSync(SIDEPANEL_MAIN_FILE, 'utf-8');

describe('sidepanel save current tabs contract', () => {
  it('delegates header Save Current Tabs through the shared sidepanel helper instead of writing groups directly', () => {
    expect(source).toContain("import { saveCurrentWindowTabsFromSidepanel } from './save-current-window-tabs';");
    expect(source).toContain('await saveCurrentWindowTabsFromSidepanel();');
  });
});
