import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, '../NotionPagePicker.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');

describe('NotionPagePicker input styling contract', () => {
  it('uses the shared Input component instead of a raw text input', () => {
    expect(source).toContain("import { Input } from '@/components/ui/input';");
    expect(source).toContain('<Input');
    expect(source).not.toContain('<input');
  });
});
