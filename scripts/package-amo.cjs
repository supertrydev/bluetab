#!/usr/bin/env node
/**
 * Build the Firefox Add-ons (AMO) upload packages from dist-firefox/.
 *
 * Outputs (release/):
 *   bluetab-<version>-firefox.zip  → AMO "Upload version" (manifest at root)
 *   bluetab-<version>-source.zip   → AMO "Source code" field. Required because
 *                                    the build bundles and minifies code. AMO
 *                                    reviewers rebuild from it and diff the
 *                                    result against the add-on file.
 *
 * The source archive comes from the committed tree (git archive HEAD), so it
 * only matches the add-on when the working tree is clean. Pass --allow-dirty
 * for a local test package (never upload one built that way).
 *
 * Run through `npm run package:amo`, which builds and lints first.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist-firefox');
const releaseDir = path.join(root, 'release');
const allowDirty = process.argv.includes('--allow-dirty');

/** Everything `npm ci && npm run build:firefox` needs, plus reviewer notes. */
const SOURCE_PATHS = [
  'BUILD-FIREFOX.md',
  'LICENSE',
  'NOTICE',
  '.nvmrc',
  'manifest.json',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'postcss.config.cjs',
  'tailwind.config.cjs',
  'components.json',
  '_locales',
  'src',
  'scripts',
];

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  console.error('PACKAGE: dist-firefox/manifest.json not found. Run `npm run build:firefox` first.');
  process.exit(1);
}

const dirty = git(['status', '--porcelain', '--untracked-files=no']);
if (dirty && !allowDirty) {
  console.error('PACKAGE: working tree has uncommitted changes, so the source zip would not match the build.');
  console.error('Commit first, or pass --allow-dirty for a local test package.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
if (!manifest.browser_specific_settings?.gecko?.id) throw new Error('gecko id missing: not a Firefox build');
if (manifest.background?.service_worker) throw new Error('Firefox build must not declare a service worker');
if (manifest.key) throw new Error('Firefox build must not contain the Chrome key');

fs.mkdirSync(releaseDir, { recursive: true });
const addonZip = path.join(releaseDir, `bluetab-${manifest.version}-firefox.zip`);
const sourceZip = path.join(releaseDir, `bluetab-${manifest.version}-source.zip`);

// 1. Add-on package: dist-firefox without hidden files or source maps.
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bluetab-amo-'));
try {
  fs.cpSync(dist, staging, { recursive: true });
  let removed = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name.endsWith('.map')) {
        fs.rmSync(full, { recursive: true, force: true });
        removed += 1;
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(staging);
  fs.rmSync(addonZip, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', addonZip, '.'], { cwd: staging, stdio: 'inherit' });
  const sizeMb = (fs.statSync(addonZip).size / (1024 * 1024)).toFixed(2);
  console.log(`PACKAGE OK: ${path.relative(root, addonZip)} (${sizeMb} MB, version ${manifest.version}${removed ? `, removed ${removed} stray files` : ''})`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

// 2. Source package for AMO reviewers (committed files only).
const present = SOURCE_PATHS.filter((p) => {
  try {
    git(['ls-files', '--error-unmatch', p]);
    return true;
  } catch {
    return false;
  }
});
const missing = SOURCE_PATHS.filter((p) => !present.includes(p));
fs.rmSync(sourceZip, { force: true });
execFileSync('git', ['archive', '--format=zip', `--prefix=bluetab-${manifest.version}-source/`, '-o', sourceZip, 'HEAD', '--', ...present], {
  cwd: root,
  stdio: 'inherit',
});
const sourceMb = (fs.statSync(sourceZip).size / (1024 * 1024)).toFixed(2);
console.log(`SOURCE OK: ${path.relative(root, sourceZip)} (${sourceMb} MB, commit ${git(['rev-parse', '--short', 'HEAD'])}${dirty ? ', DIRTY TREE: test only' : ''})`);
if (missing.length) console.log(`SOURCE NOTE: not in git yet, left out: ${missing.join(', ')}`);
