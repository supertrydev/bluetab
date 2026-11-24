import { buildHtmlExport, type HtmlExportInput } from './html-export';
import type { Project, TabGroup, Tag } from '@/types/models';

const group = (over: Partial<TabGroup> = {}): TabGroup => ({
  id: 'g1', name: 'Research', created: 1_700_000_000_000, modified: 1_700_000_000_000,
  tabs: [{ id: 't1', url: 'https://www.example.com/a', title: 'Example', timestamp: 1, groupId: 'g1', pinned: false } as TabGroup['tabs'][number]],
  ...over,
});
const build = (over: Partial<HtmlExportInput> = {}) => buildHtmlExport({
  groups: [group()], tags: [], projects: [], theme: 'light', locale: 'en', direction: 'ltr',
  labels: { title: 'Tab Groups Backup', groups: 'Groups', totalTabs: 'Total Tabs', emptyGroup: 'No tabs', untitled: 'Untitled', exportedFrom: 'Exported from Bluetab' },
  dateLabel: 'Nov 24', exportedAt: 'Nov 24, 4 PM', tabsCount: (n) => `${n} tabs`, formatDate: () => 'Nov 14', formatNumber: String, ...over,
});

describe('HTML export', () => {
  it('is self-contained: no logo, script, web font or stylesheet link', () => {
    const html = build();
    expect(html).not.toMatch(/<svg|<script|<link|@import|fonts\.googleapis|class="logo/);
    expect(html).toContain('Exported from Bluetab');
  });

  it('shows the project label, tags and note of a group', () => {
    const project = { id: 'p1', name: 'Launch', color: 'blue', icon: 'briefcase' } as Project;
    const tag = { id: 'x', name: 'Design', color: '#8b5cf6', created: 1 } as Tag;
    const html = build({ groups: [group({ projectId: 'p1', tags: ['x'], notes: 'Check prices' })], projects: [project], tags: [tag] });
    expect(html).toContain('Launch');
    expect(html).toContain('Design');
    expect(html).toContain('Check prices');
  });

  it('escapes text and attribute values', () => {
    const url = 'https://example.com/"onmouseover="alert(1)';
    const html = build({ groups: [group({ name: '<img src=x onerror=alert(1)>', tabs: [{ ...group().tabs[0], url, title: '"><script>', favicon: 'https://e.com/i.png"onerror="x' }] })] });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/"onmouseover="|"onerror="/);
  });

  it('never links unsafe addresses and ignores unsafe tag colours', () => {
    const html = build({
      groups: [group({ tags: ['x'], tabs: [{ ...group().tabs[0], url: 'javascript:alert(1)' }] })],
      tags: [{ id: 'x', name: 'T', color: 'red;background:url(https://e.com)', created: 1 } as Tag],
    });
    expect(html).not.toMatch(/href="javascript/);
    expect(html).not.toContain('background:url');
  });

  it('keeps the reading direction and theme', () => {
    expect(build({ direction: 'rtl', theme: 'dark', locale: 'ar' })).toContain('<html lang="ar" dir="rtl" class="dark">');
  });
});
