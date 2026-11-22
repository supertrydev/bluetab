import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { main } = require('../../scripts/ci/check-bundle-budget.cjs');

let root: string;
let output: string;
let baseline: string;
const manifest = { permissions: ['storage'], host_permissions: ['https://example.com/*'] };
function run(...args: string[]) {
  try {
    main([output, '--baseline', baseline, '--target', 'chrome', ...args]);
    return { status: 0, stderr: '' };
  } catch (error) {
    return { status: 1, stderr: (error as Error).message };
  }
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bluetab-budget-'));
  output = join(root, 'dist');
  baseline = join(root, 'budget.json');
  mkdirSync(join(output, 'assets'), { recursive: true });
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(output, 'assets/page-Abcd1234.js'), 'x'.repeat(100000));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('requires a baseline and allows an explicit update', () => {
  expect(run().status).toBe(1);
  expect(run('--update').status).toBe(0);
  expect(run().status).toBe(0);
});
it('ignores changing content hashes and accepts exactly 5% growth', () => {
  expect(run('--update').status).toBe(0);
  renameSync(join(output, 'assets/page-Abcd1234.js'), join(output, 'assets/page-NewHash9.js'));
  writeFileSync(join(output, 'assets/page-NewHash9.js'), 'x'.repeat(105000));
  expect(run().status).toBe(0);
  writeFileSync(join(output, 'assets/page-NewHash9.js'), 'x'.repeat(105001));
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('page');
});
it('rejects an oversized individual asset even if the total shrinks', () => {
  writeFileSync(join(output, 'assets/other-Abcd1234.js'), 'x'.repeat(500000));
  expect(run('--update').status).toBe(0);
  writeFileSync(join(output, 'assets/other-Abcd1234.js'), 'x');
  writeFileSync(join(output, 'assets/page-Abcd1234.js'), 'x'.repeat(105001));
  expect(run().status).toBe(1);
});
it('checks total growth and fails closed for unbudgeted assets', () => {
  expect(run('--update').status).toBe(0);
  writeFileSync(join(output, 'assets/new-Abcd1234.js'), 'x'.repeat(100000));
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Total');
  expect(result.stderr).toContain('Unbudgeted');
});
it.each(['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions'])('rejects a new %s entry even when bytes shrink', (field) => {
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 8) + ' '.repeat(1000));
  expect(run('--update').status).toBe(0);
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ ...manifest, [field]: [...((manifest as any)[field] || []), 'new-permission'] }));
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`${field}: new-permission`);
});
it('preserves separate browser baselines and handles duplicate logical asset names', () => {
  writeFileSync(join(output, 'assets/page-Other123.js'), 'x'.repeat(200000));
  expect(run('--update').status).toBe(0);
  expect(run('--target', 'firefox', '--update').status).toBe(0);
  expect(Object.keys(JSON.parse(readFileSync(baseline, 'utf8')).targets).sort()).toEqual(['chrome', 'firefox']);
  writeFileSync(join(output, 'assets/page-Other123.js'), 'x'.repeat(210001));
  expect(run().status).toBe(1);
});
it('lets a small asset grow by a few KB without failing', () => {
  writeFileSync(join(output, 'assets/tiny-Abcd1234.js'), 'x'.repeat(2000));
  expect(run('--update').status).toBe(0);
  writeFileSync(join(output, 'assets/tiny-Abcd1234.js'), 'x'.repeat(6000));
  expect(run().status).toBe(0);
  writeFileSync(join(output, 'assets/tiny-Abcd1234.js'), 'x'.repeat(6097));
  expect(run().status).toBe(1);
});
