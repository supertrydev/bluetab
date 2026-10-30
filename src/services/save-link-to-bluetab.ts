import { getAuthState } from '../utils/auth-state';
import { saveTabsToBlueTab, type SaveTabsToBlueTabResult } from './saved-tab-actions';

export interface SaveLinkToBlueTabOptions {
  linkUrl: string;
  linkText: string;
  now?: number;
}

function getDefaultLinkGroupName(linkUrl: string): string {
  try {
    const url = new URL(linkUrl);
    return `Link: ${url.hostname}`;
  } catch {
    return 'Saved Link';
  }
}

export async function saveLinkToBlueTab(
  {
    linkUrl,
    linkText,
    now = Date.now(),
  }: SaveLinkToBlueTabOptions,
): Promise<SaveTabsToBlueTabResult> {
  const authState = await getAuthState();
  return saveTabsToBlueTab(
    [
      {
        url: linkUrl,
        title: linkText || linkUrl,
        pinned: false,
      },
    ],
    getDefaultLinkGroupName(linkUrl),
    {
      closeSourceTabs: false,
      now,
      isPro: authState.isPro,
    },
  );
}
