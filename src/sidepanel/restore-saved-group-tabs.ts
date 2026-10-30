import type { Settings, TabGroup } from '../types/models';

export interface RestoreSidepanelGroupTabsApis {
  createTab: (properties: chrome.tabs.CreateProperties) => Promise<{ id?: number }>;
  createWindow: (data: chrome.windows.CreateData) => Promise<{
    id?: number;
    tabs?: Array<{ id?: number }>;
  }>;
  groupTabs: (options: { tabIds: number[] }) => Promise<number>;
  updateTabGroup: (groupId: number, properties: { title: string }) => Promise<unknown>;
}

interface RestoreSidepanelGroupTabsInput {
  group: TabGroup;
  settings: Pick<Partial<Settings>, 'restoreMode' | 'tabGroupRestoreMode'>;
  currentTabs: ReadonlyArray<{ url?: string }>;
  apis?: RestoreSidepanelGroupTabsApis;
}

interface RestoreSidepanelGroupTabsResult {
  createdTabIds: number[];
  groupingError?: unknown;
}

const chromeApis: RestoreSidepanelGroupTabsApis = {
  createTab: properties => chrome.tabs.create(properties),
  createWindow: data => chrome.windows.create(data),
  groupTabs: options => chrome.tabs.group(options),
  updateTabGroup: (groupId, properties) => chrome.tabGroups.update(groupId, properties),
};

function shouldCreateNewWindow(
  restoreMode: Settings['restoreMode'] | undefined,
  currentTabs: ReadonlyArray<{ url?: string }>,
): boolean {
  switch (restoreMode ?? 'smart') {
    case 'newWindow':
      return true;
    case 'currentWindow':
      return false;
    case 'smart':
      return currentTabs.some(tab => (
        tab.url
        && !tab.url.includes('src/popup/')
        && !tab.url.includes('src/options/')
        && !tab.url.includes('src/settings/')
      ));
  }
}

export async function restoreSidepanelGroupTabs({
  group,
  settings,
  currentTabs,
  apis = chromeApis,
}: RestoreSidepanelGroupTabsInput): Promise<RestoreSidepanelGroupTabsResult> {
  const createdTabIds: number[] = [];

  if (shouldCreateNewWindow(settings.restoreMode, currentTabs) && group.tabs.length > 0) {
    const restoredWindow = await apis.createWindow({
      url: group.tabs[0].url,
      focused: true,
    });
    const firstTabId = restoredWindow.tabs?.[0]?.id;
    if (typeof firstTabId === 'number') createdTabIds.push(firstTabId);

    for (let index = 1; index < group.tabs.length; index += 1) {
      const restoredTab = await apis.createTab({
        url: group.tabs[index].url,
        windowId: restoredWindow.id,
      });
      if (typeof restoredTab.id === 'number') createdTabIds.push(restoredTab.id);
    }
  } else {
    for (const tab of group.tabs) {
      const restoredTab = await apis.createTab({ url: tab.url });
      if (typeof restoredTab.id === 'number') createdTabIds.push(restoredTab.id);
    }
  }

  if (settings.tabGroupRestoreMode === 'browserGroups' && createdTabIds.length > 0) {
    try {
      const browserGroupId = await apis.groupTabs({ tabIds: createdTabIds });
      await apis.updateTabGroup(browserGroupId, { title: group.name });
    } catch (groupingError) {
      return { createdTabIds, groupingError };
    }
  }

  return { createdTabIds };
}
