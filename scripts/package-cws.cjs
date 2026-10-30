#!/usr/bin/env node
/**
 * Build the Chrome Web Store upload package from dist/.
 *
 * - Removes the manifest `key`. It only pins the unpacked development ID;
 *   the Web Store assigns the item ID itself and rejects `key` on a first
 *   upload. Keep `key` in the repository manifest for local builds (after the
 *   first upload, replace it with the store's public key from the dashboard:
 *   Package > View public key, so unpacked builds get the store ID).
 * - Zips the result with manifest.json at the archive root:
 *   release/bluetab-<version>-chrome.zip
 *
 * Run through `npm run package:cws`, which builds first.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const releaseDir = path.join(root, 'release');

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  console.error('PACKAGE: dist/manifest.json not found. Run `npm run build` first.');
  process.exit(1);
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bluetab-cws-'));
try {
  fs.cpSync(dist, staging, { recursive: true });

  const manifestPath = path.join(staging, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
  if (!/^\d+(\.\d+){0,3}$/.test(String(manifest.version))) throw new Error(`invalid version ${manifest.version}`);
  delete manifest.key;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // Nothing hidden or source-map-like belongs in the store package.
  const stray = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name.endsWith('.map')) stray.push(path.relative(staging, full));
      else if (entry.isDirectory()) walk(full);
    }
  };
  walk(staging);
  for (const file of stray) fs.rmSync(path.join(staging, file), { recursive: true, force: true });

  fs.mkdirSync(releaseDir, { recursive: true });
  const output = path.join(releaseDir, `bluetab-${manifest.version}-chrome.zip`);
  fs.rmSync(output, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', output, '.'], { cwd: staging, stdio: 'inherit' });

  const sizeMb = (fs.statSync(output).size / (1024 * 1024)).toFixed(2);
  console.log(`PACKAGE OK: ${path.relative(root, output)} (${sizeMb} MB, version ${manifest.version}, no manifest key${stray.length ? `, removed ${stray.length} stray files` : ''})`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
