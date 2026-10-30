import {
  FLOATING_BUTTON_CONTENT_SCRIPT_ID,
  FLOATING_BUTTON_HOST_ORIGINS,
  ensureFloatingButtonContentScript,
  requestFloatingButtonHostAccess,
} from './floating-button-content-script';

const chromeMock = chrome as unknown as {
  permissions: {
    contains: jest.Mock;
    request: jest.Mock;
  };
  scripting: {
    executeScript: jest.Mock;
    registerContentScripts: jest.Mock;
    unregisterContentScripts: jest.Mock;
    getRegisteredContentScripts: jest.Mock;
  };
  tabs: {
    query: jest.Mock;
  };
};

describe('floating button content script registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chromeMock.permissions.contains.mockResolvedValue(true);
    chromeMock.permissions.request.mockResolvedValue(true);
    chromeMock.scripting.getRegisteredContentScripts.mockResolvedValue([]);
    chromeMock.scripting.executeScript.mockResolvedValue(undefined);
    chromeMock.scripting.registerContentScripts.mockResolvedValue(undefined);
    chromeMock.scripting.unregisterContentScripts.mockResolvedValue(undefined);
    chromeMock.tabs.query.mockResolvedValue([]);
  });

  it('registers the content script when enabled and host access is granted', async () => {
    await expect(
      ensureFloatingButtonContentScript({ floatingButtonEnabled: true }),
    ).resolves.toEqual({
      enabled: true,
      hasHostAccess: true,
      registered: true,
    });

    expect(chromeMock.permissions.contains).toHaveBeenCalledWith({
      origins: [...FLOATING_BUTTON_HOST_ORIGINS],
    });
    expect(chromeMock.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: FLOATING_BUTTON_CONTENT_SCRIPT_ID,
        matches: [...FLOATING_BUTTON_HOST_ORIGINS],
        js: ['src/content/floating-button.js'],
        runAt: 'document_idle',
      }),
    ]);
  });

  it('does not register twice when the script already exists', async () => {
    chromeMock.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: FLOATING_BUTTON_CONTENT_SCRIPT_ID },
    ]);

    await expect(
      ensureFloatingButtonContentScript({ floatingButtonEnabled: true }),
    ).resolves.toMatchObject({ registered: true });

    expect(chromeMock.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('injects the content script into already-open web tabs after ensuring registration', async () => {
    chromeMock.tabs.query.mockResolvedValue([
      { id: 11, url: 'https://example.com' },
      { id: 12, pendingUrl: 'http://news.ycombinator.com' },
      { id: 13, url: 'chrome://settings' },
    ]);

    await ensureFloatingButtonContentScript({ floatingButtonEnabled: true });

    expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(chromeMock.scripting.executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 11 },
      files: ['src/content/floating-button.js'],
    });
    expect(chromeMock.scripting.executeScript).toHaveBeenNthCalledWith(2, {
      target: { tabId: 12 },
      files: ['src/content/floating-button.js'],
    });
  });

  it('unregisters when floating button is disabled', async () => {
    chromeMock.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: FLOATING_BUTTON_CONTENT_SCRIPT_ID },
    ]);

    await expect(
      ensureFloatingButtonContentScript({ floatingButtonEnabled: false }),
    ).resolves.toEqual({
      enabled: false,
      hasHostAccess: true,
      registered: false,
    });

    expect(chromeMock.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: [FLOATING_BUTTON_CONTENT_SCRIPT_ID],
    });
  });

  it('stays unregistered when host access is missing', async () => {
    chromeMock.permissions.contains.mockResolvedValue(false);

    await expect(
      ensureFloatingButtonContentScript({ floatingButtonEnabled: true }),
    ).resolves.toEqual({
      enabled: true,
      hasHostAccess: false,
      registered: false,
    });

    expect(chromeMock.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('requests optional host access for regular web pages', async () => {
    await expect(requestFloatingButtonHostAccess()).resolves.toBe(true);

    expect(chromeMock.permissions.request).toHaveBeenCalledWith({
      origins: [...FLOATING_BUTTON_HOST_ORIGINS],
    });
  });
});
