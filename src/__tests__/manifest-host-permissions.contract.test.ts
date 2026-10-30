import * as fs from 'fs';
import * as path from 'path';

const manifestPath = path.resolve(__dirname, '../../manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: Array<{ js?: string[] }>;
  web_accessible_resources?: Array<{ matches?: string[] }>;
};

describe('manifest host-permission hygiene', () => {
  it('does not request <all_urls> as a required host permission', () => {
    expect(manifest.host_permissions ?? []).not.toContain('<all_urls>');
    expect(manifest.host_permissions ?? []).toContain('https://supertry.net/*');
  });

  it('keeps regular web-page access behind optional host permissions', () => {
    expect(manifest.optional_host_permissions ?? []).toEqual(['http://*/*', 'https://*/*']);
  });

  it('does not statically inject the floating button content script', () => {
    const scriptFiles = (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []);
    expect(scriptFiles).not.toContain('src/content/floating-button.js');
  });

  it('does not expose web-accessible resources to <all_urls>', () => {
    const matches = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.matches ?? []);
    expect(matches).not.toContain('<all_urls>');
  });
});
