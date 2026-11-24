import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8');
}

describe('final RTL presentation residuals', () => {
  it('reuses existing localized copy for drag previews, tooltips, and reminder fallbacks', () => {
    expect(source('options/components/DragDropOverlay.tsx')).toContain(
      "t('components.masonry.moreTabs', { count: selectedTabs.size - maxPreviewTabs })",
    );
    expect(source('options/components/DragDropOverlay.tsx')).not.toContain(' more tabs`');
    expect(source('components/ProjectBadge.tsx')).toContain(
      "t('components.groupInfo.project')",
    );
    expect(source('sidepanel/components/BrainDumpPanel.tsx')).toContain(
      "t('components.brainDumpPanel.entryAria')",
    );
  });

  it('uses logical logo and reader alignment', () => {
    expect(source('styles/navbar/logo.css')).toContain('margin-inline-end:');
    expect(source('styles/navbar/logo.css')).not.toContain('margin-right:');
    expect(source('styles/popup-header.css')).toContain('margin-inline-end: 0;');
    expect(source('options/components/ReaderPanel.tsx')).toContain('text-align: start;');
    expect(source('options/components/OfflineReaderView.tsx')).toContain('text-align: start;');
  });

  it('isolates dates, timers, URLs, names, providers, and runtime errors at interpolation boundaries', () => {
    expect(source('components/auth/AccountSection.tsx')).toContain(
      "isolateBidi(formatDate(subscription.expiresAt) ?? '', 'ltr')",
    );
    expect(source('components/RestoreBackupDialog.tsx')).toContain(
      "date: isolateBidi(formatDateTime(snapshot.timestamp), 'ltr')",
    );
    expect(source('components/PomodoroStatus.tsx')).toMatch(
      /<span dir="ltr" className="font-mono font-medium text-foreground">/,
    );
    expect(source('components/nav-projects.tsx')).toContain("url: isolateBidi(url, 'ltr')");
    expect(source('components/nav-projects.tsx')).toContain('message: isolateBidi(');
    expect(source('components/integrations/LinearMirrorControl.tsx')).toContain(
      'name: isolateBidi(group.name)',
    );
    expect(source('components/integrations/LinearMirrorControl.tsx')).toContain(
      "integration: isolateBidi('Linear', 'ltr')",
    );
    expect(source('components/archive-modal/ArchiveModal.tsx')).toContain(
      'name: isolateBidi(restoredGroup.name)',
    );
  });
});
