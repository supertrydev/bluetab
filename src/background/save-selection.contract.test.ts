import * as fs from 'fs';
import * as path from 'path';

const SERVICE_WORKER_FILE = path.resolve(__dirname, 'service-worker.ts');
const source = fs.readFileSync(SERVICE_WORKER_FILE, 'utf-8');

describe('background save-selection contract', () => {
  it('routes contextual save actions through the shared browser-tab selection helper', () => {
    expect(source).toContain("await saveBrowserTabsSelection({");
    expect(source).toContain("defaultGroupName: groupName");
  });

  it('respects the close-after-save setting when adding tabs to an existing group', () => {
    expect(source).toContain('if (await shouldCloseTabsAfterSaving())');
  });

  it('routes save-link-to-new-group through the shared link-to-Bluetab helper', () => {
    expect(source).toContain("import { saveLinkToBlueTab } from '../services/save-link-to-bluetab';");
    expect(source).toContain('const result = await saveLinkToBlueTab({');
  });
});
