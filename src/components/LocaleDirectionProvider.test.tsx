/** @jest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDirection } from '@radix-ui/react-direction';
import { applyLanguagePreference, initI18n } from '@/i18n';
import { LocaleDirectionProvider } from './LocaleDirectionProvider';

function DirectionProbe() {
  const direction = useDirection();
  return <output aria-label="direction">{direction}</output>;
}

describe('LocaleDirectionProvider', () => {
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

  it('provides RTL for Arabic and reacts when the locale changes back to LTR', async () => {
    await initI18n({ language: 'ar' });

    await act(async () => {
      root.render(
        <LocaleDirectionProvider>
          <DirectionProbe />
        </LocaleDirectionProvider>,
      );
    });

    expect(container.querySelector('output')?.textContent).toBe('rtl');

    await act(async () => {
      await applyLanguagePreference('tr');
    });

    expect(container.querySelector('output')?.textContent).toBe('ltr');
  });
});
