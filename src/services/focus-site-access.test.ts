import {
  FOCUS_SITE_ACCESS_ORIGINS,
  hasFocusSiteAccess,
  requestFocusSiteAccess,
} from './focus-site-access';

describe('focus-site-access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('checks the optional site access grant for regular web pages', async () => {
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);

    const granted = await hasFocusSiteAccess();

    expect(granted).toBe(true);
    expect(chrome.permissions.contains).toHaveBeenCalledWith({
      origins: [...FOCUS_SITE_ACCESS_ORIGINS],
    });
  });

  it('requests optional site access for regular web pages', async () => {
    (chrome.permissions.request as jest.Mock).mockResolvedValue(true);

    const granted = await requestFocusSiteAccess();

    expect(granted).toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: [...FOCUS_SITE_ACCESS_ORIGINS],
    });
  });
});
