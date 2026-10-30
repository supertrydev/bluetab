/** @jest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values?.name ? `${key}:${String(values.name)}` : key),
  }),
}));

import { ConfirmationCard } from '../ConfirmationCard';

describe('ConfirmationCard — connected-app action', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: Partial<Parameters<typeof ConfirmationCard>[0]>) {
    const handlers = { onConfirm: jest.fn(), onAlwaysAllow: jest.fn(), onCancel: jest.fn() };
    act(() => {
      root.render(
        <ConfirmationCard
          tabs={[{ id: 0, title: 'Birthday' }, { id: 1, title: '2026-10-12T12:00:00 – 2026-10-12T13:00:00' }]}
          toolName="integration_action"
          integrationName="Outlook Calendar"
          isResolved={false}
          {...handlers}
          {...props}
        />,
      );
    });
    return handlers;
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
    if (!found) throw new Error(`No button ${label}`);
    return found;
  }

  it('names the app, lists what will be created and offers Allow, Always allow and Cancel', () => {
    const handlers = render({});

    expect(container.textContent).toContain('components.confirmation.integrationActionQuestion:');
    expect(container.textContent).toContain('Outlook Calendar');
    expect(container.textContent).toContain('Birthday');

    act(() => button('components.confirmation.alwaysAllowIntegrations').click());
    expect(handlers.onAlwaysAllow).toHaveBeenCalledTimes(1);
    act(() => button('components.confirmation.allow').click());
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    act(() => button('common.cancel').click());
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the outcome instead of buttons once resolved', () => {
    render({ isResolved: true, resolvedStatus: 'confirmed' });

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.textContent).toContain('components.confirmation.allowed');
  });
});
