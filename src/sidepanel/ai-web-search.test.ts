import {
  inferSearchFreshness,
  openSearchResults,
} from './ai-web-search';

describe('inferSearchFreshness', () => {
  it('infers month freshness for current-information queries', () => {
    expect(inferSearchFreshness('latest ai models')).toBe('month');
    expect(inferSearchFreshness('latest ai models')).toBe('month');
  });
});

describe('openSearchResults', () => {
  it('returns openedTabIds so follow-up tools can act on the exact opened set', async () => {
    const createdTabs = [
      { id: 101 },
      { id: 102 },
    ];
    const tabsApi = {
      create: jest
        .fn()
        .mockResolvedValueOnce(createdTabs[0])
        .mockResolvedValueOnce(createdTabs[1]),
      update: jest.fn().mockResolvedValue(undefined),
      group: jest.fn().mockResolvedValue(88),
    };
    const tabGroupsApi = {
      update: jest.fn().mockResolvedValue(undefined),
    };

    const result = await openSearchResults(
      [
        { title: 'Patika', url: 'https://patika.dev/ai-models', snippet: 'a' },
        { title: 'Webrazzi', url: 'https://webrazzi.com/ai-models', snippet: 'b' },
      ],
      'latest ai models',
      tabsApi as unknown as typeof chrome.tabs,
      tabGroupsApi as unknown as typeof chrome.tabGroups,
    );

    expect(result.openedTabIds).toEqual([101, 102]);
    expect(result.openedResults).toEqual([
      { tabId: 101, title: 'Patika', url: 'https://patika.dev/ai-models', snippet: 'a' },
      { tabId: 102, title: 'Webrazzi', url: 'https://webrazzi.com/ai-models', snippet: 'b' },
    ]);
    expect(tabsApi.group).toHaveBeenNthCalledWith(1, { tabIds: [101] });
    expect(tabsApi.group).toHaveBeenNthCalledWith(2, { tabIds: [102], groupId: 88 });
  });
});
