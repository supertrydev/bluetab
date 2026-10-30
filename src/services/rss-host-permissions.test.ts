import {
  assertFeedHostAccess,
  ensureFeedHostAccess,
  getFeedHostPermissionOrigins,
  hasFeedHostAccess,
  requestFeedHostAccess,
} from './rss-host-permissions';

const chromeMock = chrome as unknown as {
  permissions: {
    contains: jest.Mock;
    request: jest.Mock;
  };
};

describe('rss-host-permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chromeMock.permissions.contains.mockResolvedValue(false);
    chromeMock.permissions.request.mockResolvedValue(false);
  });

  it('builds exact origin patterns instead of requesting all URLs at runtime', () => {
    expect(
      getFeedHostPermissionOrigins([
        'https://www.theverge.com/rss/index.xml',
        'https://www.theverge.com/feed/second.xml',
        'http://feeds.bbci.co.uk/turkce/rss.xml',
      ]),
    ).toEqual(['http://feeds.bbci.co.uk/*', 'https://www.theverge.com/*']);
  });

  it('checks granted host access for the exact feed origins', async () => {
    chromeMock.permissions.contains.mockResolvedValue(true);

    await expect(
      hasFeedHostAccess(['https://www.theverge.com/rss/index.xml']),
    ).resolves.toBe(true);

    expect(chromeMock.permissions.contains).toHaveBeenCalledWith({
      origins: ['https://www.theverge.com/*'],
    });
  });

  it('requests exact feed origins when access is missing', async () => {
    chromeMock.permissions.contains.mockResolvedValue(false);
    chromeMock.permissions.request.mockResolvedValue(true);

    await expect(
      ensureFeedHostAccess([
        'https://www.theverge.com/rss/index.xml',
        'https://feeds.bbci.co.uk/turkce/rss.xml',
      ]),
    ).resolves.toBe(true);

    expect(chromeMock.permissions.request).toHaveBeenCalledWith({
      origins: ['https://feeds.bbci.co.uk/*', 'https://www.theverge.com/*'],
    });
  });

  it('throws a useful error when feed source access is missing', async () => {
    chromeMock.permissions.contains.mockResolvedValue(false);

    await expect(
      assertFeedHostAccess('https://evrimagaci.org/rss.xml'),
    ).rejects.toThrow('Feed source access is required for https://evrimagaci.org');
  });

  it('exposes a direct request helper for UI-triggered permission prompts', async () => {
    chromeMock.permissions.request.mockResolvedValue(true);

    await expect(
      requestFeedHostAccess(['https://www.trthaber.com/bilim_teknoloji_articles.rss']),
    ).resolves.toBe(true);

    expect(chromeMock.permissions.request).toHaveBeenCalledWith({
      origins: ['https://www.trthaber.com/*'],
    });
  });
});
