import { ArchiveSearchService } from './archive-search-service';
import { Storage } from '@/utils/storage';
import { ArchiveStorageService } from '@/utils/archive-storage';
import type { ArchiveStorage } from '@/types/archive';

const archive = {
  id: 'one', originalGroup: { id: 'g', name: '\u0130stanbul Café', tabs: [
    { id: 't', title: 'x Cafe\u0301 العَرَبِيَّة', url: 'https://one.test/\u0131\u015f\u0131k', timestamp: 1, groupId: 'g' },
  ], tags: [], created: 1, modified: 1 },
  metadata: { archivedDate: 1, accessCount: 0, restoredCount: 0 },
  protection: { passwordProtected: false }, version: '1',
};
beforeEach(() => jest.spyOn(ArchiveStorageService, 'getArchives').mockResolvedValue({
  archives: { one: archive }, metadata: { totalArchives: 1, totalSizeBytes: 0, version: '1' },
} as ArchiveStorage));
afterEach(() => jest.restoreAllMocks());

it.each(['istanbul', 'cafe', 'العربية', 'isik'])('searches archives with normalised text: %s', async (text) => {
  const { results } = await ArchiveSearchService.search({ text }, { includeTabContent: true });
  expect(results.map(result => result.archive.id)).toEqual(['one']);
});
it('highlights the original decomposed text', async () => {
  const { results } = await ArchiveSearchService.search({ text: 'العربية' });
  const highlight = results[0].highlights.find(h => h.field === 'tabTitle')!;
  expect(highlight.text.slice(highlight.matchStart, highlight.matchEnd)).toBe('العَرَبِيَّة');
});
it('preserves regex syntax and case-sensitive search options', async () => {
  expect((await ArchiveSearchService.search({ text: '\\S+' }, { regexMode: true })).results).toHaveLength(1);
  expect((await ArchiveSearchService.search({ text: 'istanbul' }, { caseSensitive: true })).results).toHaveLength(0);
  expect((await ArchiveSearchService.search({ text: 'café' }, { caseSensitive: true, wholeWords: true })).results).toHaveLength(0);
});
it('searches the persisted archive index using the shared normalisation', async () => {
  jest.spyOn(Storage, 'get').mockResolvedValue([{
    archiveId: 'one', groupName: '\u0130stanbul', tabTitles: ['Café'], tabUrls: ['https://one.test/\u0131\u015f\u0131k'], tags: ['العَرَبِيَّة'],
  }]);
  for (const query of ['istanbul', 'cafe', 'isik', 'العربية']) {
    const result = await ArchiveStorageService.searchArchives({ searchQuery: query, sortBy: 'name', sortOrder: 'asc' });
    expect(result.map(item => item.id)).toEqual(['one']);
  }
});
