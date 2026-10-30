import * as fs from 'fs';
import * as path from 'path';

const SERVICE_WORKER_FILE = path.resolve(__dirname, 'service-worker.ts');
const source = fs.readFileSync(SERVICE_WORKER_FILE, 'utf-8');

describe('background brain dump context-menu contract', () => {
  it('registers a page parent menu that is also available for text selections', () => {
    expect(source).toContain("id: 'page-parent'");
    expect(source).toContain("contexts: ['page', 'selection']");
  });

  it('adds a selection action that routes highlighted text through the shared Brain Dump save helper', () => {
    expect(source).toContain("id: 'save-selection-to-brain-dump'");
    expect(source).toContain("case 'save-selection-to-brain-dump':");
    expect(source).toContain('const selectedText = info.selectionText?.trim();');
    expect(source).toContain('await saveBrainDumpEntryWithRouting({');
    expect(source).toContain('text: selectedText');
  });
});

describe('background brain dump routing contract', () => {
  it('keeps the configured Notion auto-route unless Notion is the explicit destination', () => {
    expect(source).toContain('skipConfiguredRouting: skipsConfiguredRouting(dest),');
    expect(source).not.toContain('skipConfiguredRouting: dest !== undefined');
  });
});
