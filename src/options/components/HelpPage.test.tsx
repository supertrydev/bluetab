/** @jest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initI18n, type SupportedLanguage } from '@/i18n';
import { HelpPage } from './HelpPage';

describe('Help changelog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function openChangelog(language: SupportedLanguage): Promise<HTMLElement> {
    await initI18n({ language });
    await act(async () => root.render(<HelpPage sidebarTrigger={null} />));
    const tab = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2];
    await act(async () => {
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    const panel = document.getElementById(tab.getAttribute('aria-controls')!);
    if (!panel) throw new Error('Changelog panel not rendered');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    return panel;
  }

  it.each<[SupportedLanguage, string]>([
    ['en', 'Previous versions'],
    ['tr', '\u00d6nceki s\u00fcr\u00fcmler'],
    ['es', 'Versiones anteriores'],
    ['pt-BR', 'Versões anteriores'],
    ['id', 'Versi sebelumnya'],
    ['ar', 'الإصدارات السابقة'],
  ])('shows only the latest release and a translated releases link in %s', async (language, label) => {
    const panel = await openChangelog(language);
    expect(Array.from(panel.querySelectorAll('h3'), heading => heading.textContent)).toEqual(['v1.0.7']);
    expect(panel.textContent).toContain('2026-11');
    const items = Array.from(panel.querySelectorAll('li'), item => item.textContent);
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item?.trim()).toBeTruthy();
      expect(item).not.toContain('options.helpPage.');
    }
    const link = panel.querySelector('a');
    expect(link?.textContent).toBe(label);
    expect(link?.getAttribute('href')).toBe('https://github.com/supertrydev/bluetab/releases');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the four user-facing release notes', async () => {
    const panel = await openChangelog('en');
    expect(Array.from(panel.querySelectorAll('li'), item => item.textContent)).toEqual([
      'Deleted a group by mistake? Undo it within 10 seconds.',
      'Your saved groups, tags, projects and Brain Dump notes are now backed up automatically once a month.',
      'Smart Group Naming (Pro) names unnamed groups as soon as it is on.',
      'Lighter and quieter: Bluetab loads only your language and no longer wakes up every minute in the background.',
    ]);
  });
});
