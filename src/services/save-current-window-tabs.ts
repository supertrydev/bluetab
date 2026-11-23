import { readAvailableMemory, measureFreedMemory } from './freed-memory';
import { saveTabsToBlueTab, type SaveTabsToBlueTabResult } from './saved-tab-actions';
import { getAuthState } from '../utils/auth-state';
import { Storage } from '../utils/storage';
import type { Settings } from '../types/models';
import { initI18n, t as translate } from '../i18n';
import { formatTime } from '../i18n/format';

/**
 * "Session 14:30" in the app language and time format (was the English word
 * plus the browser-default toLocaleTimeString with seconds).
 */
async function getGeneratedGroupName(kind: 'session' | 'suspended', now: number): Promise<string> {
  await initI18n({ manageDocumentMetadata: false });
  return translate(`contextMenu.generatedGroups.${kind}`, { time: formatTime(now) });
}

export interface SaveCurrentWindowTabsResult extends SaveTabsToBlueTabResult {
  freedMemory?: Promise<number | null>;
}

export interface SaveCurrentWindowTabsOptions {
  now?: number;
  projectId?: string | null;
}

export interface SaveBrowserTabsSelectionOptions extends SaveCurrentWindowTabsOptions {
  tabs: chrome.tabs.Tab[];
  measureMemory?: boolean;
  defaultGroupName: string;
  currentWindowTabs?: chrome.tabs.Tab[];
}

function isSavableUrl(url: string | undefined): url is string {
  if (!url) return false;

  return !url.startsWith('chrome-extension://')
    && !url.startsWith('chrome://')
    && !url.startsWith('edge://')
    && !url.startsWith('about:')
    && !url.startsWith('moz-extension://')
    && url !== 'about:blank';
}

function getSavableTabs(
  tabs: chrome.tabs.Tab[],
  settings: Settings,
): chrome.tabs.Tab[] {
  let savableTabs = tabs.filter((tab) => isSavableUrl(tab.url));

  if (settings.pinnedTabsMode === 'exclude') {
    savableTabs = savableTabs.filter((tab) => !tab.pinned);
  }

  return savableTabs;
}

export async function ensureManagerTabOpenBeforeClosing(
  currentWindowTabs: chrome.tabs.Tab[],
  savableTabs: chrome.tabs.Tab[],
): Promise<void> {
  const managerUrl = chrome.runtime.getURL('src/options/index.html');
  const hasManager = currentWindowTabs.some((tab) => tab.url?.startsWith(managerUrl));
  const nonManagerIds = currentWindowTabs
    .filter((tab) => !tab.url?.startsWith(managerUrl))
    .map((tab) => tab.id)
    .filter((tabId): tabId is number => typeof tabId === 'number');

  if (!hasManager && savableTabs.length >= nonManagerIds.length) {
    await chrome.tabs.create({ url: managerUrl });
  }
}

export async function shouldCloseTabsAfterSaving(): Promise<boolean> {
  const settings = await Storage.getSettings();
  return settings.browserTabsCloseOnSave !== false;
}

export async function saveBrowserTabsSelection(
  {
    tabs,
    defaultGroupName,
    now = Date.now(),
    projectId = null,
    currentWindowTabs,
    measureMemory = false,
  }: SaveBrowserTabsSelectionOptions,
): Promise<SaveCurrentWindowTabsResult | null> {
  const windowTabs = currentWindowTabs ?? await chrome.tabs.query({ currentWindow: true });
  const settings = await Storage.getSettings();
  const savableTabs = getSavableTabs(tabs, settings);

  if (savableTabs.length === 0) {
    return null;
  }

  const closeSourceTabs = settings.browserTabsCloseOnSave !== false;
  if (closeSourceTabs) {
    await ensureManagerTabOpenBeforeClosing(windowTabs, savableTabs);
  }

  const authState = await getAuthState();
  const before = closeSourceTabs && measureMemory ? await readAvailableMemory() : null;
  const result = await saveTabsToBlueTab(
    tabs,
    defaultGroupName,
    {
      closeSourceTabs,
      now,
      projectId: projectId ?? undefined,
      isPro: authState.isPro,
    },
  );
  return {
    ...result,
    ...(closeSourceTabs && result.closedCount > 0 && before !== null
      ? { freedMemory: measureFreedMemory(before) } : {}),
  };
}

export async function saveCurrentWindowTabs(
  { now = Date.now(), projectId = null }: SaveCurrentWindowTabsOptions = {},
): Promise<SaveCurrentWindowTabsResult | null> {
  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  return saveBrowserTabsSelection({
    tabs: currentWindowTabs,
    currentWindowTabs,
    measureMemory: true,
    defaultGroupName: await getGeneratedGroupName('session', now),
    now,
    projectId,
  });
}

export async function saveSuspendedTabsFromCurrentWindow(
  { now = Date.now(), projectId = null }: SaveCurrentWindowTabsOptions = {},
): Promise<SaveCurrentWindowTabsResult | null> {
  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  const suspendedTabs = currentWindowTabs.filter((tab) => tab.discarded);

  return saveBrowserTabsSelection({
    tabs: suspendedTabs,
    currentWindowTabs,
    defaultGroupName: await getGeneratedGroupName('suspended', now),
    now,
    projectId,
  });
}
