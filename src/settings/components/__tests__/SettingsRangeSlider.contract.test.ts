import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const SETTINGS_FILES = [
  'src/settings/components/ADHDSettings.tsx',
  'src/settings/components/GeneralSettings.tsx',
] as const;
const BASE_STYLES = path.join(ROOT, 'src/styles/base.css');

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

function getRangeInputs(source: string) {
  return (source.match(/<input[\s\S]*?\/>/g) ?? []).filter((input) =>
    input.includes('type="range"'),
  );
}

describe('settings range slider styling contract', () => {
  it('uses the shared settings range class for every settings slider', () => {
    for (const file of SETTINGS_FILES) {
      const rangeInputs = getRangeInputs(readWorkspaceFile(file));

      expect(rangeInputs.length).toBeGreaterThan(0);
      for (const input of rangeInputs) {
        expect(input).toContain('settings-range');
      }
    }
  });

  it('styles native slider tracks instead of relying on the input background', () => {
    const css = fs.readFileSync(BASE_STYLES, 'utf-8');

    expect(css).toContain('.settings-range::-webkit-slider-runnable-track');
    expect(css).toContain('.settings-range::-moz-range-track');
    expect(css).toContain('background: var(--settings-range-track);');
  });
});
