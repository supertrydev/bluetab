import * as fs from 'fs';
import * as path from 'path';

const FLOW_PAGE_FILE = path.resolve(__dirname, '../main.tsx');
const source = fs.readFileSync(FLOW_PAGE_FILE, 'utf-8');

describe('Flow AI consent entrypoint contract', () => {
  it('does not leave the AI proposal button permanently disabled when history permission is missing', () => {
    expect(source).toContain("import { hasHistoryPermission, requestHistoryPermission } from '@/services/history-permission';");
    expect(source).toContain('const handleOpenProposalModal');
    expect(source).toContain('await requestHistoryPermission()');
    expect(source).not.toContain("import { ConsentModal } from '../settings/components/ConsentModal';");
    expect(source).not.toContain('setShowConsentModal(true)');
    expect(source).not.toContain('disabled={!hasHistoryPermission}');
  });
});
