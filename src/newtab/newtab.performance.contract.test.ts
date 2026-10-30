import * as fs from 'fs';
import * as path from 'path';

const MAIN_FILE = path.resolve(__dirname, './main.tsx');
const COMPONENT_FILE = path.resolve(__dirname, './NewTab.tsx');

const mainSource = fs.readFileSync(MAIN_FILE, 'utf-8');
const componentSource = fs.readFileSync(COMPONENT_FILE, 'utf-8');

describe('new tab performance contract', () => {
  it('does not block first render on extension-wide i18n bootstrap', () => {
    expect(mainSource).not.toContain("from '@/i18n'");
    expect(mainSource).not.toContain('await initI18n()');
  });

  it('keeps the new tab surface free from react-i18next and shared i18n format helpers', () => {
    expect(componentSource).not.toContain("from 'react-i18next'");
    expect(componentSource).not.toContain("from '@/i18n/format'");
  });

  it('avoids heavy shared services in the initial new tab render path', () => {
    expect(mainSource).not.toContain("from '../utils/TextSizeService'");
    expect(componentSource).not.toContain("from 'framer-motion'");
    expect(componentSource).not.toContain("from '@/components/PomodoroStatus'");
    expect(componentSource).not.toContain("from '@/hooks/useSimplifyMode'");
    expect(componentSource).not.toContain("from '@/utils/storage'");
    expect(componentSource).not.toContain("from '@/utils/sorting'");
  });
});
