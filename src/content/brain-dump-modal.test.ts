/** @jest-environment jsdom */
import { BRAIN_DUMP_STRINGS } from '../i18n/brain-dump-strings';

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = '';
  document.documentElement.lang = 'fr';
  document.documentElement.dir = 'ltr';
  delete (window as any).__bluetabBrainDumpModalOpen;
});
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
});

it('mounts translated RTL content without changing the host document locale', async () => {
  (chrome.runtime.sendMessage as jest.Mock).mockResolvedValue({
    language: 'ar', direction: 'rtl',
    strings: { ...BRAIN_DUMP_STRINGS, 'brainDumpModal.title': 'Localized capture' },
  });
  require('./brain-dump-modal');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const backdrop = document.querySelector<HTMLElement>('[data-bluetab-brain-dump="backdrop"]');
  expect(backdrop?.lang).toBe('ar');
  expect(backdrop?.dir).toBe('rtl');
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Localized capture');
  expect(document.documentElement.lang).toBe('fr');
  expect(document.documentElement.dir).toBe('ltr');
});

it('opens with the English subset when the worker cannot reply', async () => {
  (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message) => {
    if (message.action === 'brain-dump:get-presentation') return Promise.reject(new Error('Worker unavailable'));
    return undefined;
  });
  require('./brain-dump-modal');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector<HTMLElement>('[data-bluetab-brain-dump="backdrop"]')?.lang).toBe('en');
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(BRAIN_DUMP_STRINGS['brainDumpModal.title']);
});
