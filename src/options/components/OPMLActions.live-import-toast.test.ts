import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, './OPMLActions.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../i18n/locales/en.json'),
  'utf-8',
));

describe('OPMLActions live import toast contract', () => {
  it('uses sonner loading toasts for long-running OPML imports', () => {
    expect(source).toContain("import { toast as sonnerToast } from 'sonner'");
    expect(source).toContain("sonnerToast.loading(t('options.opml.importingCount', { current: 0, total: opmlFeeds.length })");
    expect(source).toContain("sonnerToast.loading(t('options.opml.importingCount', { current: i + 1, total: opmlFeeds.length })");
    expect(english.options.opml.importingCount).toBe('Importing {{current}}/{{total}} feeds');
  });

  it('updates the same toast id until the import resolves', () => {
    expect(source).toContain('const toastId = `feed-import-${Date.now()}`');
    expect(source).toContain('{ id: toastId');
    expect(source).toContain('sonnerToast.success(message, { id: toastId })');
  });

  it('surfaces partial and full failures in the live import toast', () => {
    expect(source).toContain('sonnerToast.warning(message, { id: toastId })');
    expect(source).toContain("sonnerToast.error(t('options.opml.failedImportCount', { count: failCount })");
    expect(source).toContain("label: isolateBidi(formatFeedLabel(feed.title, feed.xmlUrl), feed.title.trim() ? 'auto' : 'ltr')");
    expect(english.options.opml.failedImportCount_one).toBe('Failed to import {{count}} feed');
    expect(english.options.opml.failedImportCount_other).toBe('Failed to import {{count}} feeds');
    expect(english.options.opml.currentFeed).toBe('Current: {{label}}');
  });
});
