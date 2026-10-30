import * as fs from 'fs';
import * as path from 'path';

const SOURCE_FILE = path.resolve(__dirname, './service-worker.ts');
const source = fs.readFileSync(SOURCE_FILE, 'utf-8');

describe('service worker i18n wiring', () => {
  it('rebuilds context menus from translation keys', () => {
    expect(source).toContain("translate('contextMenu.root')");
    expect(source).toContain("translate('contextMenu.sendToIntegration')");
    expect(source).toContain("translate('contextMenu.saveToIntegration'");
  });

  it('localizes quick-send notifications', () => {
    expect(source).toContain("translate('notifications.quickSendUnsupported'");
    expect(source).toContain("translate('notifications.quickSendSuccess'");
    expect(source).toContain("translate('notifications.quickSendError'");
  });

  it('localizes the restricted-page Brain Dump message', () => {
    expect(source).toContain("translate('notifications.brainDumpRestricted')");
    expect(source).not.toContain("const message = \"Can't capture here");
  });
});
