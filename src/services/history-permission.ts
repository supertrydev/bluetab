export async function hasHistoryPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return false;
  }

  return chrome.permissions.contains({ permissions: ['history'] });
}

export async function requestHistoryPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return false;
  }

  return chrome.permissions.request({ permissions: ['history'] });
}
