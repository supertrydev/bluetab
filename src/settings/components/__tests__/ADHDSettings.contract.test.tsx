import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, '../ADHDSettings.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../i18n/locales/en.json'),
  'utf-8',
));

describe('ADHDSettings Flowtime contract', () => {
  it('renders an auto-focus toggle inside the Flowtime section', () => {
    expect(source).toContain("t('settings.adhd.autoFocusTitle')");
    expect(source).toContain("t('settings.adhd.autoFocusDescription')");
    expect(english.settings.adhd.autoFocusTitle).toBe('Auto-focus');
    expect(english.settings.adhd.autoFocusDescription).toBe('Automatically start Focus Mode when a Flowtime session begins.');
  });
});
