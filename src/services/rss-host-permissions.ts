const RSS_OPTIONAL_HOST_ORIGINS = ['http://*/*', 'https://*/*'] as const;

function toFeedOriginPattern(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

export function getFeedHostPermissionOrigins(urls: string[]): string[] {
  const patterns = urls
    .map((url) => toFeedOriginPattern(url))
    .filter((pattern): pattern is string => Boolean(pattern));

  return [...new Set(patterns)].sort();
}

export async function hasFeedHostAccess(urls: string[]): Promise<boolean> {
  const origins = getFeedHostPermissionOrigins(urls);
  if (origins.length === 0) return true;
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return false;
  return chrome.permissions.contains({ origins });
}

export async function requestFeedHostAccess(urls: string[]): Promise<boolean> {
  const origins = getFeedHostPermissionOrigins(urls);
  if (origins.length === 0) return true;
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return false;
  return chrome.permissions.request({ origins });
}

export async function ensureFeedHostAccess(urls: string[]): Promise<boolean> {
  const origins = getFeedHostPermissionOrigins(urls);
  if (origins.length === 0) return true;

  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return false;
  }

  const alreadyGranted = await chrome.permissions.contains({ origins });
  if (alreadyGranted) return true;

  if (!chrome.permissions?.request) {
    return false;
  }

  return chrome.permissions.request({ origins });
}

export async function assertFeedHostAccess(url: string): Promise<void> {
  const origins = getFeedHostPermissionOrigins([url]);
  if (origins.length === 0) return;

  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    throw new Error('Feed source access could not be verified');
  }

  const granted = await chrome.permissions.contains({ origins });
  if (!granted) {
    const target = origins[0]?.replace(/\/\*$/, '') ?? 'this feed source';
    throw new Error(`Feed source access is required for ${target}`);
  }
}

export { RSS_OPTIONAL_HOST_ORIGINS };
