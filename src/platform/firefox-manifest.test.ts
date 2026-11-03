import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  FIREFOX_ADDON_ID,
  FIREFOX_MIN_VERSION,
  FIREFOX_OPTIONAL_DATA_COLLECTION,
  toFirefoxManifest,
} from './firefox-manifest';

const chromeManifest = JSON.parse(readFileSync(resolve(__dirname, '../../manifest.json'), 'utf8'));

describe('toFirefoxManifest', () => {
  const firefox = toFirefoxManifest(chromeManifest) as Record<string, any>;

  it('runs the background as a module event page, not a service worker', () => {
    expect(firefox.background).toEqual({
      scripts: [chromeManifest.background.service_worker],
      type: 'module',
    });
  });

  it('replaces the Chrome side panel with a Firefox sidebar', () => {
    expect(firefox.side_panel).toBeUndefined();
    expect(firefox.sidebar_action.default_panel).toBe(chromeManifest.side_panel.default_path);
    expect(firefox.sidebar_action.open_at_install).toBe(false);
  });

  it('drops Chrome-only permissions and the Chrome key', () => {
    for (const permission of ['sidePanel', 'offscreen', 'favicon', 'windows', 'commands']) {
      expect(firefox.permissions).not.toContain(permission);
    }
    expect(firefox.permissions).toEqual(expect.arrayContaining(['tabs', 'tabGroups', 'storage', 'declarativeNetRequest']));
    expect(firefox.key).toBeUndefined();
  });

  it('declares a fixed add-on ID, minimum version and data collection', () => {
    expect(firefox.browser_specific_settings.gecko).toEqual({
      id: FIREFOX_ADDON_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      data_collection_permissions: {
        required: ['none'],
        optional: FIREFOX_OPTIONAL_DATA_COLLECTION,
      },
    });
  });

  it('keeps only icons whose file matches the declared size', () => {
    for (const [size, file] of Object.entries(firefox.icons as Record<string, string>)) {
      expect(file).toContain(`icon${size}.`);
    }
    expect(Object.keys(firefox.icons)).toEqual(expect.arrayContaining(['16', '32', '48', '128']));
  });

  it('keeps everything else (version, commands, optional permissions) unchanged', () => {
    expect(firefox.version).toBe(chromeManifest.version);
    expect(firefox.commands).toEqual(chromeManifest.commands);
    expect(firefox.optional_permissions).toEqual(chromeManifest.optional_permissions);
    expect(firefox.optional_host_permissions).toEqual(chromeManifest.optional_host_permissions);
  });

  it('adds bluet.in access so Share works without CORS (Firefox origin is random per install)', () => {
    expect(firefox.host_permissions).toEqual([...chromeManifest.host_permissions, 'https://bluet.in/*']);
  });

  it('does not modify the Chrome manifest object', () => {
    expect(chromeManifest.background.service_worker).toBeDefined();
    expect(chromeManifest.side_panel).toBeDefined();
    expect(chromeManifest.permissions).toContain('sidePanel');
  });
});
