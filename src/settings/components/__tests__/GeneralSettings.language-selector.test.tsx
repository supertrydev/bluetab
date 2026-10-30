/** @jest-environment jsdom */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initI18n } from '@/i18n';
import { getDefaultSettings } from '@/utils/sorting';
import { Storage } from '@/utils/storage';
import { GeneralSettings } from '../GeneralSettings';

jest.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      aria-label="language-selector"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

describe('GeneralSettings language selector', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.spyOn(Storage, 'set').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    jest.restoreAllMocks();
  });

  it('shows and persists the Arabic option using its native label', async () => {
    await initI18n({ language: 'en' });
    const onSettingsChange = jest.fn();
    const settings = getDefaultSettings();

    await act(async () => {
      root.render(
        <GeneralSettings settings={settings} onSettingsChange={onSettingsChange} />,
      );
    });

    const selector = container.querySelector('select[aria-label="language-selector"]');
    if (!(selector instanceof HTMLSelectElement)) throw new Error('Language selector not rendered');
    const arabicOption = [...selector.options].find((option) => option.value === 'ar');

    expect(arabicOption?.textContent).toBe('العربية');

    await act(async () => {
      selector.value = 'ar';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(Storage.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ language: 'ar' }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'ar' }),
    );
  });

  it('shows and persists the Brazilian Portuguese option', async () => {
    await initI18n({ language: 'pt-BR' });
    const onSettingsChange = jest.fn();
    const settings = getDefaultSettings();

    await act(async () => {
      root.render(
        <GeneralSettings settings={settings} onSettingsChange={onSettingsChange} />,
      );
    });

    const selector = container.querySelector('select[aria-label="language-selector"]');
    if (!(selector instanceof HTMLSelectElement)) throw new Error('Language selector not rendered');
    const portugueseOption = [...selector.options].find((option) => option.value === 'pt-BR');

    expect(portugueseOption?.textContent).toBe('Português (Brasil)');

    await act(async () => {
      selector.value = 'pt-BR';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(Storage.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ language: 'pt-BR' }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'pt-BR' }),
    );
  });

  it('shows and persists the Indonesian option', async () => {
    await initI18n({ language: 'id' });
    const onSettingsChange = jest.fn();
    const settings = getDefaultSettings();

    await act(async () => {
      root.render(
        <GeneralSettings settings={settings} onSettingsChange={onSettingsChange} />,
      );
    });

    const selector = container.querySelector('select[aria-label="language-selector"]');
    if (!(selector instanceof HTMLSelectElement)) throw new Error('Language selector not rendered');
    const indonesianOption = [...selector.options].find((option) => option.value === 'id');

    expect(indonesianOption?.textContent).toBe('Bahasa Indonesia');

    await act(async () => {
      selector.value = 'id';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(Storage.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ language: 'id' }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'id' }),
    );
  });
});
