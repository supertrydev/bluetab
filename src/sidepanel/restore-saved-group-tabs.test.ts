import type { TabGroup } from '../types/models';
import {
  restoreSidepanelGroupTabs,
  type RestoreSidepanelGroupTabsApis,
} from './restore-saved-group-tabs';

const savedGroup: TabGroup = {
  id: 'group-1',
  name: 'Frontend Research',
  tabs: [
    {
      id: 'tab-1',
      groupId: 'group-1',
      title: 'React',
      url: 'https://react.dev',
      timestamp: 1,
    },
    {
      id: 'tab-2',
      groupId: 'group-1',
      title: 'TypeScript',
      url: 'https://typescriptlang.org',
      timestamp: 2,
    },
  ],
  created: 1,
  modified: 2,
};

function createApis(): jest.Mocked<RestoreSidepanelGroupTabsApis> {
  return {
    createTab: jest
      .fn()
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 }),
    createWindow: jest.fn(),
    createGroup: jest.fn().mockResolvedValue(77),
  };
}

describe('restoreSidepanelGroupTabs', () => {
  it('keeps the acting page visible while the first Group Memory notice is shown', async () => {
    const apis = createApis();
    apis.createWindow.mockResolvedValue({ id: 9, tabs: [{ id: 201 }] });
    await restoreSidepanelGroupTabs({
      group: savedGroup, settings: { restoreMode: 'newWindow' }, currentTabs: [], apis, keepFocus: true,
    });
    expect(apis.createWindow).toHaveBeenCalledWith({ url: 'https://react.dev', focused: false });
    expect(apis.createTab).toHaveBeenCalledWith({ url: 'https://typescriptlang.org', windowId: 9, active: false });
  });

  it('restores current-window tabs into one named browser group when configured', async () => {
    const apis = createApis();

    const result = await restoreSidepanelGroupTabs({
      group: savedGroup,
      settings: {
        restoreMode: 'currentWindow',
        tabGroupRestoreMode: 'browserGroups',
      },
      currentTabs: [{ url: 'https://already-open.example' }],
      apis,
    });

    expect(apis.createWindow).not.toHaveBeenCalled();
    expect(apis.createTab).toHaveBeenNthCalledWith(1, { url: 'https://react.dev' });
    expect(apis.createTab).toHaveBeenNthCalledWith(2, { url: 'https://typescriptlang.org' });
    expect(apis.createGroup).toHaveBeenCalledTimes(1);
    expect(apis.createGroup).toHaveBeenCalledWith({ tabIds: [101, 102] }, { title: 'Frontend Research' });
    expect(result).toEqual({ createdTabIds: [101, 102] });
  });

  it('keeps current-window tabs ungrouped in normal restore mode', async () => {
    const apis = createApis();

    const result = await restoreSidepanelGroupTabs({
      group: savedGroup,
      settings: {
        restoreMode: 'currentWindow',
        tabGroupRestoreMode: 'normal',
      },
      currentTabs: [],
      apis,
    });

    expect(apis.createGroup).not.toHaveBeenCalled();
    expect(result).toEqual({ createdTabIds: [101, 102] });
  });

  const threeTabGroup: TabGroup = {
    ...savedGroup,
    tabs: [
      ...savedGroup.tabs,
      {
        id: 'tab-3',
        groupId: 'group-1',
        title: 'Vite',
        url: 'https://vite.dev',
        timestamp: 3,
      },
    ],
  };

  function createNewWindowApis(): jest.Mocked<RestoreSidepanelGroupTabsApis> {
    const apis = createApis();
    apis.createWindow.mockResolvedValue({ id: 9, tabs: [{ id: 201 }] });
    apis.createTab = jest
      .fn()
      .mockResolvedValueOnce({ id: 202 })
      .mockResolvedValueOnce({ id: 203 });
    return apis;
  }

  function expectRestoredIntoNewWindow(apis: jest.Mocked<RestoreSidepanelGroupTabsApis>) {
    expect(apis.createWindow).toHaveBeenCalledTimes(1);
    expect(apis.createWindow).toHaveBeenCalledWith({ url: 'https://react.dev', focused: true });
    expect(apis.createTab).toHaveBeenCalledTimes(2);
    expect(apis.createTab).toHaveBeenNthCalledWith(1, { url: 'https://typescriptlang.org', windowId: 9 });
    expect(apis.createTab).toHaveBeenNthCalledWith(2, { url: 'https://vite.dev', windowId: 9 });
    expect(apis.createGroup).toHaveBeenCalledTimes(1);
    expect(apis.createGroup).toHaveBeenCalledWith({ tabIds: [201, 202, 203] }, { title: 'Frontend Research' });
  }

  it('restores into a new window and groups every created tab in newWindow mode', async () => {
    const apis = createNewWindowApis();

    const result = await restoreSidepanelGroupTabs({
      group: threeTabGroup,
      settings: { restoreMode: 'newWindow', tabGroupRestoreMode: 'browserGroups' },
      currentTabs: [],
      apis,
    });

    expectRestoredIntoNewWindow(apis);
    expect(result).toEqual({ createdTabIds: [201, 202, 203] });
  });

  it('opens a new window in smart mode when the current window already has web tabs', async () => {
    const apis = createNewWindowApis();

    const result = await restoreSidepanelGroupTabs({
      group: threeTabGroup,
      settings: { restoreMode: 'smart', tabGroupRestoreMode: 'browserGroups' },
      currentTabs: [{ url: 'https://already-open.example' }],
      apis,
    });

    expectRestoredIntoNewWindow(apis);
    expect(result).toEqual({ createdTabIds: [201, 202, 203] });
  });

  it('stays in the current window in smart mode when only BlueTab pages are open', async () => {
    const apis = createApis();

    const result = await restoreSidepanelGroupTabs({
      group: savedGroup,
      settings: { restoreMode: 'smart', tabGroupRestoreMode: 'normal' },
      currentTabs: [{ url: 'chrome-extension://abc/src/options/index.html' }, {}],
      apis,
    });

    expect(apis.createWindow).not.toHaveBeenCalled();
    expect(apis.createTab).toHaveBeenNthCalledWith(1, { url: 'https://react.dev' });
    expect(apis.createTab).toHaveBeenNthCalledWith(2, { url: 'https://typescriptlang.org' });
    expect(result).toEqual({ createdTabIds: [101, 102] });
  });
});
