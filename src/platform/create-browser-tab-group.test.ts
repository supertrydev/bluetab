import { createBrowserTabGroup } from './create-browser-tab-group';

describe('createBrowserTabGroup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates the replacement group when the browser changes its ID', async () => {
    (chrome.tabs.group as jest.Mock).mockResolvedValue(12);
    jest.mocked(chrome.tabs.get).mockResolvedValue({ groupId: 15 } as chrome.tabs.Tab);
    (chrome.tabGroups.update as jest.Mock)
      .mockRejectedValueOnce(new Error('No group with id: 12'))
      .mockResolvedValue({ id: 15 } as chrome.tabGroups.TabGroup);

    await expect(createBrowserTabGroup({ tabIds: [7] }, { title: 'Research' })).resolves.toBe(15);
    expect(chrome.tabs.group).toHaveBeenCalledTimes(1);
    expect(chrome.tabGroups.update).toHaveBeenLastCalledWith(15, { title: 'Research' });
  });

  it('does not ask Opera to create a group with a single tab', async () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Chromium/139 OPR/139.0' });
    try {
      await expect(createBrowserTabGroup({ tabIds: [7] }, { title: 'Research' }))
        .rejects.toThrow('Opera requires at least two tabs');
      expect(chrome.tabs.group).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original });
    }
  });

  it('propagates unrelated failures without retrying', async () => {
    (chrome.tabs.group as jest.Mock).mockResolvedValue(12);
    (chrome.tabGroups.update as jest.Mock).mockRejectedValueOnce(new Error('Permission denied'));

    await expect(createBrowserTabGroup({ tabIds: [7] }, { title: 'Research' })).rejects.toThrow('Permission denied');
    expect(chrome.tabs.get).not.toHaveBeenCalled();
  });
});
