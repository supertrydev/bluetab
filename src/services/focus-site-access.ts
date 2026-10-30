export const FOCUS_SITE_ACCESS_ORIGINS = ['http://*/*', 'https://*/*'] as const;

function getFocusSiteAccessOrigins(): string[] {
  return [...FOCUS_SITE_ACCESS_ORIGINS];
}

export async function hasFocusSiteAccess(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return false;
  }
  return chrome.permissions.contains({ origins: getFocusSiteAccessOrigins() });
}

export async function requestFocusSiteAccess(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return false;
  }
  return chrome.permissions.request({ origins: getFocusSiteAccessOrigins() });
}
