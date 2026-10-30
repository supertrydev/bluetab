import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, '../AISettings.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');

describe('AISettings direct-permission contract', () => {
  it('removes the consent modal re-entry surface', () => {
    expect(source).not.toContain("import { ConsentModal } from './ConsentModal';");
    expect(source).not.toContain('Review privacy consent');
    expect(source).not.toContain('<ConsentModal');
  });
});
