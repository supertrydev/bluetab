import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src/components', relativePath), 'utf8');
}

describe('shared product surfaces RTL contract', () => {
  it('uses logical inline spacing for shared forms, archive, auth, sync, and integration controls', () => {
    for (const fileName of [
      'AddGroupToProjectModal.tsx',
      'CWSReviewPrompt.tsx',
      'GroupInfoModal.tsx',
      'RestoreBackupDialog.tsx',
      'TextSizeSetting.tsx',
      'auth/LoginModal.tsx',
      'auth/AccountSection.tsx',
      'archive-modal/ArchiveActions.tsx',
      'archive-modal/ArchiveDeleteModal.tsx',
      'archive-modal/ArchiveHeader.tsx',
      'archive-modal/ArchiveRestoreModal.tsx',
      'bluet/BluetConnectionSection.tsx',
      'integrations/LinearMirrorControl.tsx',
      'sync/SyncSettings.tsx',
      'sync/SyncSetupDialog.tsx',
    ]) {
      expect(source(fileName)).not.toMatch(
        /(?:className|className=\{)[^\n]*(?:\bml-|\bmr-|\bpl-|\bpr-|\bborder-l\b|\bborder-r\b|\btext-left\b|\btext-right\b|\bspace-x-)/,
      );
    }
  });

  it('isolates shared user content, dates, identifiers, and password/token inputs', () => {
    expect(source('AddGroupToProjectModal.tsx')).toContain('<bdi dir="auto">{group.name}</bdi>');
    expect(source('GroupInfoModal.tsx')).toContain('<bdi dir="auto">{group.name}</bdi>');
    expect(source('GroupInfoModal.tsx')).toContain('dir="ltr"');
    expect(source('MasonryGroupCard.tsx')).toContain('<bdi dir="auto">{project.name}</bdi>');
    expect(source('MasonryGroupCard.tsx')).toContain('<bdi dir="auto">{highlightMatch(group.notes, searchQuery)}</bdi>');
    expect(source('auth/AccountSection.tsx')).toContain('<bdi dir="ltr">{user.email}</bdi>');
    expect(source('auth/LoginModal.tsx')).toMatch(/type="email"[\s\S]*?dir="ltr"/);
    expect(source('sync/SyncSettings.tsx')).toContain('<bdi dir="auto">');
    expect(source('sync/SyncSettings.tsx')).toContain('<bdi dir="ltr">');
    expect(source('sync/SyncSetupDialog.tsx')).toMatch(/id="sync-password"[\s\S]*?dir="ltr"/);
  });

  it('mirrors only semantic shared arrows and preserves physical controls', () => {
    expect(source('MasonryGroupCard.tsx')).toMatch(/ChevronRight className="[^"]*rtl:rotate-180/);
    expect(source('bluet/BluetConnectionSection.tsx')).toMatch(/ArrowLeft className="[^"]*rtl:rotate-180/);
    expect(source('auth/LoginModal.tsx')).not.toMatch(/<(?:Eye|EyeOff|ExternalLink)[^>]*rtl:/);
    expect(source('archive-modal/ArchiveDeleteModal.tsx')).not.toMatch(/<Trash2[^>]*rtl:/);
  });
});
