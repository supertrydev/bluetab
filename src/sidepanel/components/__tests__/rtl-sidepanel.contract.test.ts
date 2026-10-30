import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as browserGroupCardModule from '../BrowserGroupCard';

function source(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'src/sidepanel/components', fileName), 'utf8');
}

describe('sidepanel RTL presentation contract', () => {
  it.each([
    {
      name: 'LTR at the 320px inline-start edge',
      input: {
        anchorLeft: 2,
        anchorRight: 16,
        anchorBottom: 40,
        direction: 'ltr' as const,
        viewportWidth: 320,
      },
      expected: { left: 8, top: 46 },
    },
    {
      name: 'RTL at the 320px inline-start edge',
      input: {
        anchorLeft: 302,
        anchorRight: 316,
        anchorBottom: 40,
        direction: 'rtl' as const,
        viewportWidth: 320,
      },
      expected: { left: 190, top: 46 },
    },
    {
      name: 'LTR at the 400px inline-end edge',
      input: {
        anchorLeft: 382,
        anchorRight: 396,
        anchorBottom: 64,
        direction: 'ltr' as const,
        viewportWidth: 400,
      },
      expected: { left: 270, top: 70 },
    },
    {
      name: 'RTL at the 400px inline-start edge',
      input: {
        anchorLeft: 382,
        anchorRight: 396,
        anchorBottom: 64,
        direction: 'rtl' as const,
        viewportWidth: 400,
      },
      expected: { left: 270, top: 70 },
    },
  ])('keeps the browser-group color picker inside the viewport: $name', ({ input, expected }) => {
    const computePosition = (
      browserGroupCardModule as typeof browserGroupCardModule & {
        computeColorPickerPosition?: (value: typeof input) => { left: number; top: number };
      }
    ).computeColorPickerPosition;

    expect(computePosition).toBeDefined();
    expect(computePosition?.(input)).toEqual(expected);
  });

  it('mirrors semantic disclosure and back arrows without mirroring action icons', () => {
    for (const fileName of [
      'GroupsPanel.tsx',
      'BrowserGroupCard.tsx',
      'PinnedTabsSection.tsx',
      'UngroupedTabsSection.tsx',
    ]) {
      expect(source(fileName)).toMatch(/ChevronRight className="[^"]*rtl:rotate-180/);
    }

    expect(source('AIPanel.tsx')).toMatch(/ChevronLeft className="[^"]*rtl:rotate-180/);
    expect(source('TabItem.tsx')).not.toMatch(/<X className="[^"]*rtl:/);
    expect(source('BrainDumpEntry.tsx')).not.toMatch(/<ExternalLink className="[^"]*rtl:/);
  });

  it('uses logical inline spacing for sidepanel copy and action rows', () => {
    for (const fileName of [
      'GroupsPanel.tsx',
      'BrowserGroupCard.tsx',
      'PinnedTabsSection.tsx',
      'UngroupedTabsSection.tsx',
      'BrainDumpEntry.tsx',
      'ConfirmationCard.tsx',
      'ActionBar.tsx',
      'PomodoroBar.tsx',
    ]) {
      expect(source(fileName)).not.toMatch(/(?:className|className=\{)[^\n]*(?:\bml-|\bmr-|\bpl-|\bpr-|\bborder-l\b|\bborder-r\b|\btext-left\b|\btext-right\b)/);
    }

    const assistantCss = readFileSync(
      resolve(process.cwd(), 'src/styles/aui-overrides.css'),
      'utf8',
    );
    expect(assistantCss).toContain('padding-inline-start: 1rem !important;');
    expect(assistantCss).toContain('margin-inline-start: 0.375rem !important;');
  });

  it('isolates user and technical content at the rendering boundary', () => {
    expect(source('GroupsPanel.tsx')).toContain('<bdi dir="auto">{highlightMatch(group.name, search)}</bdi>');
    expect(source('GroupsPanel.tsx')).toContain('<bdi dir="auto">{highlightMatch(tab.title, search)}</bdi>');
    expect(source('TabItem.tsx')).toContain('<bdi dir="auto">');
    expect(source('BrainDumpEntry.tsx')).toContain('dir="auto"');
    expect(source('BrainDumpEntry.tsx')).toContain('dir="ltr"');
    expect(source('AIPanel.tsx')).toContain('<bdi dir="auto">{thread.title}</bdi>');
    expect(source('AIPanel.tsx')).toContain('<bdi dir="auto">\n              {aiChat.threads.find');
    expect(source('ActionBar.tsx')).toContain('<bdi dir="auto">{group.title ||');
    expect(source('AIPanel.tsx')).toContain('dir="ltr"');
    expect(source('BrowserGroupCard.tsx')).toMatch(/<input[\s\S]*?dir="auto"[\s\S]*?value=\{editTitle\}/);
    expect(source('GroupsPanel.tsx')).toMatch(/<Input[\s\S]*?dir="auto"[\s\S]*?value=\{editName\}/);
    expect(source('PomodoroBar.tsx')).toMatch(/<span dir="ltr"[^>]*>[\s\S]*?\{formatTime\(remaining\)\}/);
    expect(source('ConfirmationCard.tsx')).toContain('name: isolateBidi(projectMeta.name)');
    expect(source('AIChatThread.tsx')).toContain('<UserMessage.Content dir="auto" />');
    expect(source('AIChatThread.tsx')).toContain('<AssistantMessage.Content dir="auto" />');
    expect(source('AIChatThread.tsx')).toContain('<Composer.Input dir="auto" autoFocus />');
  });

  it('overrides assistant-ui physical offsets with logical spacing and isolates code', () => {
    const assistantCss = readFileSync(
      resolve(process.cwd(), 'src/styles/aui-overrides.css'),
      'utf8',
    );

    expect(assistantCss).toContain('inset-inline-end: -0.75rem !important;');
    expect(assistantCss).toContain('margin-inline-end: 1rem !important;');
    expect(assistantCss).toContain('margin-inline-start: -0.5rem !important;');
    expect(assistantCss).toContain('margin-inline-start: auto !important;');
    expect(assistantCss).toMatch(/\.aui-md pre,\s*\.aui-md code \{[\s\S]*?direction: ltr !important;[\s\S]*?unicode-bidi: isolate;/);
  });

  it('places sidepanel notifications at the logical inline end', () => {
    const sidepanelMain = readFileSync(
      resolve(process.cwd(), 'src/sidepanel/main.tsx'),
      'utf8',
    );

    expect(sidepanelMain).toContain("direction === 'rtl' ? 'bottom-left' : 'bottom-right'");
    expect(sidepanelMain).not.toContain('<Toaster richColors position="bottom-right" />');
  });
});
