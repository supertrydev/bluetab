import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), 'src', path), 'utf8');
}

describe('popup, options, feeds, and flow RTL presentation contract', () => {
  it('mirrors semantic navigation and disclosure arrows without mirroring action icons', () => {
    expect(source('popup/main.tsx')).toMatch(/ChevronRight className="[^"]*rtl:rotate-180/);
    expect(source('popup/pages/ArchivePage.tsx')).toMatch(/ArrowLeft className="[^"]*rtl:rotate-180/);
    expect(source('options/components/FeedsPage.tsx')).toMatch(/ArrowLeft className="[^"]*rtl:rotate-180/);
    expect(source('options/components/OfflineReaderView.tsx')).toMatch(/ArrowLeft className="[^"]*rtl:rotate-180/);
    expect(source('flow/FlowProposalModal.tsx')).toMatch(/ChevronRight className="[^"]*rtl:rotate-180/);
    expect(source('options/components/WrappedExperience.tsx')).toMatch(/ChevronLeft className="[^"]*rtl:rotate-180/);

    for (const fileName of [
      'popup/components/modals/ModalWrapper.tsx',
      'popup/components/archive/ArchiveViewModal.tsx',
      'options/components/FeedsPage.tsx',
      'options/components/WrappedExperience.tsx',
    ]) {
      expect(source(fileName)).not.toMatch(/<(?:X|ExternalLink)[^>]*className="[^"]*rtl:/);
    }
  });

  it('uses logical inline layout where placement follows the locale direction', () => {
    for (const fileName of [
      'popup/main.tsx',
      'popup/pages/ArchivePage.tsx',
      'popup/components/archive/SearchFilters.tsx',
      'popup/components/archive/ArchiveViewModal.tsx',
      'popup/components/modals/ArchiveModal.tsx',
      'popup/components/modals/ModalWrapper.tsx',
      'options/components/AddFeedDialog.tsx',
      'options/components/ArticleListPanel.tsx',
      'options/components/FeedsPage.tsx',
      'options/components/GroupListView.tsx',
      'options/components/HelpPage.tsx',
      'options/components/OfflineFailureBanner.tsx',
      'options/components/ReminderQuickPicker.tsx',
      'flow/FlowProposalModal.tsx',
      'flow/main.tsx',
    ]) {
      expect(source(fileName)).not.toMatch(
        /(?:className|className=\{)[^\n]*(?:\bml-|\bmr-|\bpl-|\bpr-|\bborder-l\b|\bborder-r\b|\btext-left\b|\btext-right\b|\bleft-\d|\bright-\d)/,
      );
    }

    expect(source('options/components/ReaderPanel.tsx')).toContain('border-inline-start: 4px solid');
    expect(source('options/components/OfflineReaderView.tsx')).toContain('border-inline-start: 4px solid');

    for (const fileName of [
      'account/main.tsx',
      'feeds/main.tsx',
      'flow/main.tsx',
      'options/main.tsx',
      'popup/main.tsx',
    ]) {
      expect(source(fileName)).toContain("direction === 'rtl' ? 'bottom-left' : 'bottom-right'");
      expect(source(fileName)).not.toContain('rtl:flex-row-reverse');
    }
  });

  it('isolates dynamic labels and technical values at their rendering boundaries', () => {
    expect(source('popup/main.tsx')).toContain('<bdi dir="auto">{group.name}</bdi>');
    expect(source('popup/main.tsx')).toContain('<bdi dir="auto">{tab.title}</bdi>');
    expect(source('popup/components/archive/ArchiveViewModal.tsx')).toContain('<bdi dir="ltr">{tab.url}</bdi>');

    expect(source('options/components/FeedListPanel.tsx')).toContain('<bdi dir="auto">{feed.title}</bdi>');
    expect(source('options/components/ArticleListPanel.tsx')).toContain('<bdi dir="auto">{article.title}</bdi>');
    expect(source('options/components/ArticleListPanel.tsx')).toContain('dir="ltr"');
    expect(source('options/components/OfflineFailureBanner.tsx')).toContain('<bdi dir="ltr">{f.url}</bdi>');
    expect(source('options/components/StatsDashboard.tsx')).toContain('dir="ltr"');

    expect(source('flow/main.tsx')).toContain('<bdi dir="auto">{rule.name}</bdi>');
    expect(source('flow/main.tsx')).toContain('<bdi dir="auto">{template.name}</bdi>');
    expect(source('flow/FlowProposalModal.tsx')).toContain('<bdi dir="auto">{editedProposal.name}</bdi>');
    expect(source('flow/FlowProposalModal.tsx')).toContain('dir="ltr"');
  });
});
