import * as fs from 'fs';
import * as path from 'path';

const addFeedDialogSource = fs.readFileSync(
  path.resolve(__dirname, '../../feeds/components/AddFeedDialog.tsx'),
  'utf-8',
);
const feedsPageSource = fs.readFileSync(
  path.resolve(__dirname, '../../feeds/components/FeedsPage.tsx'),
  'utf-8',
);
const opmlActionsSource = fs.readFileSync(
  path.resolve(__dirname, '../../feeds/opml.ts'),
  'utf-8',
);
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../i18n/locales/en.json'),
  'utf-8',
));

describe('RSS host access permission contract', () => {
  it('requests host access before previewing a manually added feed', () => {
    expect(addFeedDialogSource).toContain('ensureFeedHostAccess');
    expect(addFeedDialogSource).toContain("t('options.addFeedDialog.siteAccessRequired')");
    expect(english.options.addFeedDialog.siteAccessRequired).toBe('Bluetab needs site access to preview this feed');
  });

  it('requests host access before importing OPML feeds in bulk', () => {
    expect(opmlActionsSource).toContain('ensureFeedHostAccess');
    expect(opmlActionsSource).toContain("t('options.opml.siteAccessRequired')");
    expect(english.options.opml.siteAccessRequired).toBe('Feed import needs site access to the selected sources');
  });

  it('requests host access before manual feed refresh so existing feeds recover cleanly', () => {
    expect(feedsPageSource).toContain('ensureFeedHostAccess');
    expect(feedsPageSource).toContain("t('options.feedsPage.siteAccessRequired')");
    expect(english.options.feedsPage.siteAccessRequired).toBe('Site access is required to refresh these feeds');
  });
});
