/**
 * @module platform/firefox-manifest
 *
 * WHY:  manifest.json is written for Chrome. Firefox needs a different
 *       background declaration, a sidebar instead of a side panel, a fixed
 *       add-on ID and the data collection declaration AMO requires for
 *       every new add-on (since 3 Nov 2025).
 *
 * WHAT: toFirefoxManifest(chromeManifest) → manifest for dist-firefox/.
 *       Used by vite.config.ts when BLUETAB_BROWSER=firefox.
 */

/** Permanent AMO add-on ID. Never change it after the first AMO upload. */
export const FIREFOX_ADDON_ID = 'bluetab@supertry.net';

/**
 * 139: tabGroups API. 140: built-in data collection consent (desktop).
 * Both are required, so 140 is the floor (current ESR is 153).
 */
export const FIREFOX_MIN_VERSION = '140.0';

/** Keep in sync with FIREFOX_ACCOUNT_DATA_COLLECTION in extension-platform.ts. */
export const FIREFOX_OPTIONAL_DATA_COLLECTION = [
  'authenticationInfo',
  'personallyIdentifyingInfo',
  'browsingActivity',
  'websiteContent',
];

/** Chrome-only permissions Firefox does not know (they only cause warnings). */
const CHROME_ONLY_PERMISSIONS = new Set(['system.memory', 'sidePanel', 'offscreen', 'favicon', 'windows', 'commands']);

/**
 * Chrome tolerates reusing a smaller PNG for a bigger size key (64 → icon48,
 * 256 → icon128); AMO warns. Keep only entries whose file name states the
 * same size as the key (icon16.png for "16").
 */
function sizeMatchedIcons(icons: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!icons) return icons;
  return Object.fromEntries(Object.entries(icons).filter(([size, file]) => file.includes(`icon${size}.`)));
}

/**
 * Firefox skips CORS only for hosts in host_permissions (measured on Firefox
 * 159). Chrome reaches bluet.in (Share) through its CORS allowlist, which
 * names the fixed Chrome extension origin; Firefox's origin is a random UUID
 * per install, so the Firefox build asks for bluet.in access instead.
 */
const FIREFOX_EXTRA_HOST_PERMISSIONS = ['https://bluet.in/*'];

type Manifest = Record<string, unknown> & {
  permissions?: string[];
  host_permissions?: string[];
  background?: { service_worker?: string; type?: string };
  side_panel?: { default_path?: string };
  action?: { default_icon?: Record<string, string> };
};

export function toFirefoxManifest(chromeManifest: Manifest): Manifest {
  const manifest: Manifest = JSON.parse(JSON.stringify(chromeManifest));

  // Chrome pins the unpacked extension ID with `key`; Firefox uses gecko.id.
  delete manifest.key;

  manifest.permissions = (manifest.permissions ?? []).filter((p) => !CHROME_ONLY_PERMISSIONS.has(p));

  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), ...FIREFOX_EXTRA_HOST_PERMISSIONS])];

  manifest.icons = sizeMatchedIcons(manifest.icons as Record<string, string> | undefined);
  if (manifest.action?.default_icon) {
    manifest.action.default_icon = sizeMatchedIcons(manifest.action.default_icon);
  }

  // Firefox MV3 runs the background as an event page (no service worker).
  const backgroundScript = manifest.background?.service_worker;
  if (!backgroundScript) throw new Error('manifest.background.service_worker missing');
  manifest.background = { scripts: [backgroundScript], type: 'module' } as Manifest['background'];

  // Chrome side panel → Firefox sidebar. The toolbar button toggles it
  // (configureToolbarOpensSidePanel in extension-platform.ts).
  const panelPath = manifest.side_panel?.default_path;
  delete manifest.side_panel;
  if (panelPath) {
    const icons = manifest.action?.default_icon ?? {};
    manifest.sidebar_action = {
      default_panel: panelPath,
      default_title: '__MSG_appName__',
      default_icon: { '16': icons['16'], '32': icons['32'] },
      open_at_install: false,
    };
  }

  manifest.browser_specific_settings = {
    // Desktop only: Firefox for Android has no tab groups or sidebar.
    gecko: {
      id: FIREFOX_ADDON_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      data_collection_permissions: {
        // The free core (saving, groups, Brain Dump) works offline and
        // without an account; only signing in sends data.
        required: ['none'],
        optional: [...FIREFOX_OPTIONAL_DATA_COLLECTION],
      },
    },
  };

  return manifest;
}
