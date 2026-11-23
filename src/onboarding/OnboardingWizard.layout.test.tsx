/** @jest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initI18n, i18n } from '@/i18n';
import { OnboardingWizard } from './OnboardingWizard';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { Storage } from '@/utils/storage';
import { ThemeManager } from '@/utils/theme';

jest.mock('@/assets/bluetab-avatar.png', () => 'avatar.png');
jest.mock('@/utils/storage', () => ({ Storage: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('@/utils/theme', () => ({ ThemeManager: { getCurrentTheme: jest.fn().mockResolvedValue('system'), applyTheme: jest.fn() } }));
jest.mock('@/platform/extension-platform', () => ({ openOnboardingSidePanel: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/floating-button-content-script', () => ({ hasFloatingButtonHostAccess: jest.fn().mockResolvedValue(false), requestFloatingButtonHostAccess: jest.fn().mockResolvedValue(false) }));
jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: { div: ({ children }: { children: ReactNode }) => <div>{children}</div> },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await initI18n({ language: 'en' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<form><LocaleDirectionProvider><OnboardingWizard /></LocaleDirectionProvider></form>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('keeps the same footer outside the scrolling content for every core and advanced step', async () => {
  const footer = container.querySelector('footer')!;
  expect(footer).not.toBeNull();
  const card = footer.parentElement!;
  expect(card.style.height).toContain('min(680px');
  expect(card.style.height).toContain('calc(100dvh - 2rem)');
  expect(card.classList.contains('flex-col')).toBe(true);
  const scrollArea = card.querySelector('.overflow-y-auto')!;
  expect(scrollArea.contains(footer)).toBe(false);
  expect(footer.classList.contains('shrink-0')).toBe(true);
  for (let step = 0; step < 12; step++) {
    expect(container.querySelector('footer')).toBe(footer);
    expect(footer.parentElement).toBe(card);
    expect(scrollArea.querySelector('h1')?.textContent).toBeTruthy();
    if (step === 6) {
      const explore = Array.from(scrollArea.querySelectorAll('button')).find(b => b.textContent?.includes(i18n.t('onboarding.done.exploreAdvanced')))!;
      await act(async () => explore.click());
    }
    if (step < 11) {
      scrollArea.scrollTop = 80;
      await act(async () => (footer.querySelectorAll('button')[1] as HTMLButtonElement).click());
      expect(scrollArea.scrollTop).toBe(0);
    }
  }
  expect(footer.textContent).toContain(i18n.t('onboarding.finish'));
});

it('uses labelled language and theme selects with all original options and immediate changes', async () => {
  const controls = container.querySelectorAll('[role="combobox"]');
  expect(controls).toHaveLength(2);
  for (const control of controls) expect(container.querySelector(`label[for="${control.id}"]`)?.textContent).toBeTruthy();
  const selects = container.querySelectorAll('select');
  expect(Array.from(selects[0].options).map(o => o.value)).toEqual(['system', 'en', 'tr', 'es', 'pt-BR', 'id', 'ar']);
  expect(Array.from(selects[1].options).map(o => o.value)).toEqual(['system', 'light', 'dark']);
  await act(async () => { selects[0].value = 'ar'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); });
  expect(i18n.resolvedLanguage).toBe('ar');
  expect(document.documentElement.dir).toBe('rtl');
  expect(container.querySelector('[role="combobox"]')?.getAttribute('dir')).toBe('rtl');
  await act(async () => { selects[1].value = 'dark'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); });
  expect(ThemeManager.applyTheme).toHaveBeenCalledWith('dark');
  expect(Storage.set).toHaveBeenCalledWith('settings', expect.objectContaining({ language: 'ar' }));
});
