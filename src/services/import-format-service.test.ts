import {
  analyzeImportFile,
  detectImportFormat,
} from './import-format-service';
import type { TabGroup } from '@/types/models';

const now = 1_800_000_000_000;

let uuidCounter = 0;

Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: jest.fn(() => `uuid-${++uuidCounter}`),
  },
  writable: true,
});

beforeEach(() => {
  uuidCounter = 0;
  jest.spyOn(Date, 'now').mockReturnValue(now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function existingGroup(): TabGroup {
  return {
    id: 'existing-group',
    name: 'Existing',
    tabs: [
      {
        id: 'existing-tab',
        url: 'https://duplicate.example/',
        title: 'Duplicate',
        timestamp: now,
        groupId: 'existing-group',
      },
    ],
    created: now,
    modified: now,
  };
}

describe('import-format-service', () => {
  it('detects a BlueTab backup JSON only when backup metadata is present', () => {
    const backup = JSON.stringify({
      version: '2.3.0',
      exportedAt: now,
      groups: [{ id: 'g1', name: 'Saved', tabs: [] }],
    });

    expect(detectImportFormat('backup.json', backup).format).toBe('bluetab-backup');

    const generic = JSON.stringify({
      groups: [{ name: 'Reading', tabs: [{ url: 'https://example.com', title: 'Example' }] }],
    });

    expect(detectImportFormat('tabs.json', generic).format).toBe('generic-json');
  });

  it('builds a preview from a plain tab list and reports skipped invalid rows', () => {
    const content = [
      '# Research',
      'Docs | https://developer.chrome.com/docs/webstore/',
      'not a url',
      '',
      '# Product',
      'https://example.com Alpha',
      'https://duplicate.example/ Already saved',
    ].join('\n');

    const preview = analyzeImportFile({
      fileName: 'tabs.txt',
      content,
      existingGroups: [existingGroup()],
      duplicateHandling: 'reject',
    });

    expect(preview.format).toBe('tab-list');
    expect(preview.groupCount).toBe(2);
    expect(preview.tabCount).toBe(2);
    expect(preview.skippedInvalidUrls).toEqual(['not a url']);
    expect(preview.skippedDuplicates).toEqual(['https://duplicate.example/']);
    expect(preview.groups?.[0]).toMatchObject({
      name: 'Research',
      tabs: [
        expect.objectContaining({
          title: 'Docs',
          url: 'https://developer.chrome.com/docs/webstore/',
        }),
      ],
    });
    expect(preview.groups?.[0].tabs[0].groupId).toBe(preview.groups?.[0].id);
  });

  it('builds a preview from generic JSON groups without showing product-specific format names', () => {
    const content = JSON.stringify({
      groups: [
        {
          title: 'Launch',
          tabs: [
            { title: 'Roadmap', url: 'https://example.com/roadmap' },
            { url: 'chrome://extensions' },
          ],
        },
      ],
    });

    const preview = analyzeImportFile({
      fileName: 'tabs.json',
      content,
      existingGroups: [],
      duplicateHandling: 'allow',
    });

    expect(preview.format).toBe('generic-json');
    expect(preview.label).toBe('JSON');
    expect(preview.groupCount).toBe(1);
    expect(preview.tabCount).toBe(1);
    expect(preview.skippedInvalidUrls).toEqual(['chrome://extensions']);
    expect(preview.groups?.[0].name).toBe('Launch');
  });

  it('imports a workspace export with collections (lists of cards) as one group per collection', () => {
    // Same shape as a real export: workspaces hold collections, collections hold cards.
    const content = JSON.stringify({
      version: 4,
      groups: [
        { name: 'My Collections', type: 'personal', lists: [] },
        {
          name: 'My First Space',
          type: 'private',
          lists: [
            {
              title: 'New collection',
              labelIds: [],
              cards: [
                { title: 'Temp Mail - Disposable Temporary Email', url: 'https://temp-mail.org/en/', customTitle: '' },
                { title: 'Page title', url: 'https://example.com/renamed', customTitle: 'My name for it' },
              ],
            },
            { title: 'Reading', cards: [{ title: 'Docs', url: 'https://example.com/docs' }] },
          ],
        },
      ],
      labels: {},
    });

    const preview = analyzeImportFile({
      fileName: 'export-2026-10-22-23-42-28.json',
      content,
      existingGroups: [],
      duplicateHandling: 'allow',
    });

    expect(preview.format).toBe('generic-json');
    expect(preview.groupCount).toBe(2);
    expect(preview.tabCount).toBe(3);
    expect(preview.groups?.map((group) => group.name)).toEqual(['New collection', 'Reading']);
    expect(preview.groups?.[0].tabs.map((tab) => [tab.title, tab.url])).toEqual([
      ['Temp Mail - Disposable Temporary Email', 'https://temp-mail.org/en/'],
      ['My name for it', 'https://example.com/renamed'],
    ]);
  });

  it('keeps dashes and pipes inside titles of a "url | title" text export', () => {
    // One link per line as "url | title"; a blank line starts the next group.
    const content = [
      'https://en.wikipedia.org/wiki/German_Shepherd | German Shepherd - Wikipedia',
      'https://example.com/e-mail | Set up e-mail – Help',
      '',
      'https://developer.mozilla.org/en-US/docs/Web/CSS/grid | CSS grid layout | MDN',
      'https://example.com',
    ].join('\n');

    const preview = analyzeImportFile({
      fileName: 'tabs.txt',
      content,
      existingGroups: [],
      duplicateHandling: 'allow',
    });

    expect(preview.groupCount).toBe(2);
    expect(preview.groups?.map((group) => group.tabs.map((tab) => tab.title))).toEqual([
      ['German Shepherd - Wikipedia', 'Set up e-mail – Help'],
      ['CSS grid layout | MDN', 'example.com'],
    ]);
  });

  it('imports a collections → folders → links JSON export, one group per folder', () => {
    // Exports often start with a byte order mark.
    const content = '\uFEFF' + JSON.stringify({
      collections: [
        {
          title: 'Furry friends',
          folders: [
            { title: 'Dogs', links: [{ title: 'German Shepherd - Wikipedia', url: 'https://en.wikipedia.org/wiki/German_Shepherd' }] },
            { links: [{ title: 'Ragdoll kitten', url: 'https://www.youtube.com/results?search_query=Ragdoll+kitten' }] },
          ],
        },
        {
          title: 'Reptiles',
          folders: [{ title: 'Lizards', links: [{ title: 'Gecko', url: 'https://en.wikipedia.org/wiki/Gecko' }] }],
        },
      ],
    });

    const preview = analyzeImportFile({
      fileName: 'export.json',
      content,
      existingGroups: [],
      duplicateHandling: 'allow',
    });

    expect(preview.format).toBe('generic-json');
    expect(preview.tabCount).toBe(3);
    expect(preview.groups?.map((group) => group.name)).toEqual([
      'Furry friends · Dogs',
      'Furry friends · Window 2',
      'Reptiles',
    ]);
    expect(preview.groups?.[0].tabs[0].title).toBe('German Shepherd - Wikipedia');
  });

  it('imports a sessions → windows → tabs JSON export', () => {
    const content = '\uFEFF' + JSON.stringify({
      sessions: [
        { name: 'Old session', windows: [{ tabs: [{ title: 'Gecko', url: 'https://en.wikipedia.org/wiki/Gecko' }] }] },
      ],
    });

    const preview = analyzeImportFile({
      fileName: 'backup.json',
      content,
      existingGroups: [],
      duplicateHandling: 'allow',
    });

    expect(preview.format).toBe('generic-json');
    expect(preview.groups?.map((group) => [group.name, group.tabs.length])).toEqual([['Old session', 1]]);
  });

  it('does not read valid JSON without known tabs as a plain text list', () => {
    const content = JSON.stringify({ version: 1, things: [{ note: 'see https://example.com/page' }] });

    expect(detectImportFormat('data.json', content).format).toBe('unsupported');
    expect(detectImportFormat('data.txt', content).format).toBe('unsupported');
  });

  it('identifies bookmark HTML files for the modal parser path', () => {
    const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="https://example.com">Example</A>';

    const detection = detectImportFormat('bookmarks.html', html);

    expect(detection.format).toBe('bookmark-html');
    expect(detection.label).toBe('Bookmark HTML');
  });

  it('returns unsupported when no importable tabs or backup data can be found', () => {
    const preview = analyzeImportFile({
      fileName: 'notes.txt',
      content: 'remember to organize tabs later',
      existingGroups: [],
      duplicateHandling: 'allow',
    });

    expect(preview.format).toBe('unsupported');
    expect(preview.error).toContain('No importable tabs');
  });
});
