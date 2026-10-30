import * as fs from 'node:fs';
import * as path from 'node:path';

describe('floating button content script contract', () => {
  it('stays self-contained without top-level imports', () => {
    const sourcePath = path.resolve(process.cwd(), 'src/content/floating-button.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/^\s*import\s.+from\s.+;$/m);
  });

  it('tracks SPA-style URL changes so linked-page effects stay in sync', () => {
    const sourcePath = path.resolve(process.cwd(), 'src/content/floating-button.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).toContain('history.pushState');
    expect(source).toContain('history.replaceState');
    expect(source).toContain("window.addEventListener('popstate'");
    expect(source).toContain("window.addEventListener('hashchange'");
    expect(source).toContain('currententrychange');
    expect(source).toContain("window.setInterval(syncFromLocation, 750)");
  });

  it('receives localized user-visible titles without importing the shared runtime', () => {
    const sourcePath = path.resolve(process.cwd(), 'src/content/floating-button.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).toContain('response.floatingButtonTitles');
    expect(source).toContain('settings.titles.saveTabsLeft');
    expect(source).toContain('settings.titles.summarizePage');
    expect(source).toContain('settings.titles.saveAllOtherTabs');
    expect(source).toContain('settings.titles.saveTabsRight');
    expect(source).toContain('settings.titles.hide');
    expect(source).not.toContain("'Save this tab (hold for all tabs)'");
    expect(source).not.toContain("'Save tabs to the left'");
    expect(source).not.toContain("'Summarize page to Dump'");
    expect(source).not.toContain("'Save all other tabs'");
    expect(source).not.toContain("'Save tabs to the right'");
    expect(source).not.toContain("'Hide floating button (reappears on page reload)'");
  });

  it('shows a short note bubble once per page that opens the Dump tab on click', () => {
    const sourcePath = path.resolve(process.cwd(), 'src/content/floating-button.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).toContain('currentButtonTitles.relatedDumpBubble');
    expect(source).toContain('relatedDumpBubbleShownFor.has(pageKey)');
    expect(source).toContain('const RELATED_DUMP_BUBBLE_MS = 6000;');
    expect(source).toContain("document.visibilityState !== 'visible'");
    // Note text is rendered as text, never as HTML.
    expect(source).toContain('text.textContent = currentDumpMatch.preview');
    expect(source).not.toMatch(/innerHTML\s*=\s*currentDumpMatch/);
    expect(source).toContain('-webkit-line-clamp: 3;');
    expect(source).toContain("chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL_BRAIN_DUMP' }");
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('applies locale metadata only to its injected root while preserving physical tab actions', () => {
    const sourcePath = path.resolve(process.cwd(), 'src/content/floating-button.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).toContain('host.lang = settings.language');
    expect(source).toContain('host.dir = settings.direction');
    expect(source).toContain('direction: ltr;');
    expect(source).not.toMatch(/document\.documentElement\.(?:lang|dir)/);
    expect(source).toContain("position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'");
  });
});
