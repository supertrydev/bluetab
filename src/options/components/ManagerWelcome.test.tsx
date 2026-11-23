/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { initI18n } from '@/i18n';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { ManagerWelcome } from './ManagerWelcome';

it.each(['en', 'ar'] as const)('shows just Done, with correct direction in %s', async language => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await initI18n({ language });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onDone = jest.fn();
  await act(async () => root.render(<LocaleDirectionProvider><ManagerWelcome kind="sample" onDone={onDone} /></LocaleDirectionProvider>));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute('dir')).toBe(language === 'ar' ? 'rtl' : 'ltr');
  expect(dialog.querySelectorAll('button')).toHaveLength(1);
  await act(async () => dialog.querySelector('button')!.click());
  expect(onDone).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  container.remove();
});
