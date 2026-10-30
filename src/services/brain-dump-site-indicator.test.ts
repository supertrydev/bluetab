import { BRAIN_DUMP_INBOX_KEY } from '@/types/adhd';
import { getBrainDumpSiteIndicator } from './brain-dump-site-indicator';

const chromeMock = chrome as unknown as {
  storage: {
    local: {
      get: jest.Mock;
    };
  };
  runtime: {
    lastError?: { message: string };
  };
};

describe('brain dump site indicator', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    chromeMock.runtime.lastError = undefined;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns true when local storage contains a matching Brain Dump site', async () => {
    chromeMock.storage.local.get.mockImplementation((key, callback) => {
      callback({
        [key]: [
          {
            id: 'entry-1',
            text: 'Saved note',
            createdAt: Date.now(),
            tabContext: {
              url: 'https://www.example.com/article?b=2&a=1',
              title: 'Example',
            },
          },
        ],
      });
    });

    await expect(getBrainDumpSiteIndicator('https://www.example.com/article?a=1&b=2#here')).resolves.toBe(true);
    expect(chromeMock.storage.local.get).toHaveBeenCalledWith(BRAIN_DUMP_INBOX_KEY, expect.any(Function));
  });

  it('fails closed when the storage read reports a runtime error', async () => {
    chromeMock.storage.local.get.mockImplementation((_key, callback) => {
      chromeMock.runtime.lastError = { message: 'storage unavailable' };
      callback({});
      chromeMock.runtime.lastError = undefined;
    });

    await expect(getBrainDumpSiteIndicator('https://example.com/now')).resolves.toBe(false);
  });

  it('fails closed when chrome.storage.local.get throws synchronously', async () => {
    chromeMock.storage.local.get.mockImplementation(() => {
      throw new Error('storage threw');
    });

    await expect(getBrainDumpSiteIndicator('https://example.com/now')).resolves.toBe(false);
  });
});
