#!/usr/bin/env node
// Baselines use logical asset names: Rollup content hashes change every build.
// Multiple chunks with the same name are compared largest-first, individually.
const fs = require('fs');
const path = require('path');
const PERMISSION_FIELDS = ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions'];

function measure(directory) {
  const assets = {};
  let total = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile()) throw new Error(`Unsupported build entry: ${file}`);
      const size = fs.statSync(file).size;
      total += size;
      const relative = path.relative(directory, file).split(path.sep).join('/');
      const key = relative.replace(/^(assets\/.+)-[\w-]{8}(\.[^.]+)$/, '$1$2');
      (assets[key] ||= []).push(size);
    }
  }
  walk(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  return {
    total,
    assets: Object.fromEntries(Object.keys(assets).sort().map((key) => [key, assets[key].sort((a, b) => b - a)])),
    ...Object.fromEntries(PERMISSION_FIELDS.map((field) => [field, [...(manifest[field] || [])].sort()])),
  };
}

const ASSET_MIN_SLACK_BYTES = 4096;

function main(args = process.argv.slice(2)) {
  let directory = 'dist';
  let baselineFile = path.join(__dirname, 'bundle-budget.json');
  let target;
  let update = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') update = true;
    else if (args[i] === '--baseline') baselineFile = args[++i];
    else if (args[i] === '--target') target = args[++i];
    else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
    else directory = args[i];
  }
  directory = path.resolve(directory);
  target ||= path.basename(directory) === 'dist-firefox' ? 'firefox' : 'chrome';
  if (!['chrome', 'firefox'].includes(target)) throw new Error('Target must be chrome or firefox');
  const current = measure(directory);
  const baseline = fs.existsSync(baselineFile)
    ? JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
    : { version: 1, targets: {} };
  if (baseline.version !== 1 || !baseline.targets) throw new Error('Invalid bundle baseline');
  if (update) {
    baseline.targets[target] = current;
    fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`BUNDLE-BUDGET: updated ${target} baseline (${current.total} bytes). Review size and permission changes before committing.`);
    return;
  }
  const previous = baseline.targets[target];
  if (!previous) throw new Error(`Missing ${target} baseline. Run with --update after reviewing this build.`);
  const failures = [];
  if (current.total > previous.total * 1.05) failures.push(`Total: ${current.total} bytes exceeds ${previous.total} + 5%`);
  for (const [asset, sizes] of Object.entries(current.assets)) {
    const old = previous.assets[asset];
    if (!old || sizes.length > old.length) failures.push(`Unbudgeted asset: ${asset} (review and use --update)`);
    sizes.forEach((size, i) => {
      // Small files may grow by a few KB without noise; large ones by at most 5 %.
      if (old?.[i] !== undefined && size > Math.max(old[i] * 1.05, old[i] + ASSET_MIN_SLACK_BYTES)) failures.push(`${asset}[${i}]: ${size} bytes exceeds ${old[i]} + max(5%, ${ASSET_MIN_SLACK_BYTES} bytes)`);
    });
  }
  for (const field of PERMISSION_FIELDS) {
    for (const permission of current[field]) {
      if (!(previous[field] || []).includes(permission)) failures.push(`New ${field}: ${permission}`);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`BUNDLE-BUDGET OK: ${target}, ${current.total} bytes; all assets within 5%, no added permissions.`);
}
module.exports = { main };
if (require.main === module) try { main(); } catch (error) {
  console.error(`BUNDLE-BUDGET FAILED: ${error.message}`);
  process.exitCode = 1;
}
