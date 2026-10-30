import { hasHistoryPermission, requestHistoryPermission } from '../history-permission';

describe('history-permission service', () => {
  beforeEach(() => {
    (chrome.permissions.contains as jest.Mock).mockReset();
    (chrome.permissions.request as jest.Mock).mockReset();
  });

  it('checks the optional history permission through chrome.permissions.contains', async () => {
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);

    await expect(hasHistoryPermission()).resolves.toBe(true);
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ permissions: ['history'] });
  });

  it('requests the optional history permission through chrome.permissions.request', async () => {
    (chrome.permissions.request as jest.Mock).mockResolvedValue(true);

    await expect(requestHistoryPermission()).resolves.toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['history'] });
  });
});
