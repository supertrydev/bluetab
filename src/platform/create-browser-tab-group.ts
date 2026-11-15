type NewGroupOptions = Pick<chrome.tabs.GroupOptions, 'tabIds' | 'createProperties'>;

export function minimumBrowserGroupTabs(): number {
  // Opera Tab Islands dissolve when only one tab remains.
  return /\b(?:OPR|Opera)\//i.test(globalThis.navigator?.userAgent ?? '') ? 2 : 1;
}

export async function createBrowserTabGroup(
  options: NewGroupOptions & { tabIds: number[] },
  properties: chrome.tabGroups.UpdateProperties,
): Promise<number> {
  if (new Set(options.tabIds).size < minimumBrowserGroupTabs()) {
    throw new Error('Opera requires at least two tabs to create a group.');
  }
  let groupId = await chrome.tabs.group(options);

  for (let attempt = 0; ; attempt += 1) {
    try {
      await chrome.tabGroups.update(groupId, properties);
      return groupId;
    } catch (error) {
      if (attempt === 2 || !/No group with id/i.test(String(error))) throw error;

      // Some browsers expose the final group ID on the tab after grouping.
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      const tab = await chrome.tabs.get(options.tabIds[0]).catch(() => undefined);
      if (tab && tab.groupId >= 0) groupId = tab.groupId;
    }
  }
}
