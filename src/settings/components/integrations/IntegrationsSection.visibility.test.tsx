/** @jest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IntegrationsSection } from './IntegrationsSection';
import type { IntegrationAccount } from '@/types/integrations';

const mockListConnectedAccounts = jest.fn<Promise<IntegrationAccount[]>, []>();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/auth/useAuth', () => ({
  useAuth: () => ({ isPro: true }),
}));

jest.mock('@/services/integration-token-storage', () => ({
  listConnectedAccounts: () => mockListConnectedAccounts(),
}));

jest.mock('./IntegrationCard', () => ({
  IntegrationCard: ({ entry }: { entry: { id: string } }) => (
    <div data-integration-card={entry.id}>{entry.id}</div>
  ),
}));

jest.mock('./IntegrationReauthBanner', () => ({
  IntegrationReauthBanner: () => null,
}));

describe('IntegrationsSection provider availability', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn(),
          },
        },
      },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderSection(accounts: IntegrationAccount[]): Promise<void> {
    mockListConnectedAccounts.mockResolvedValue(accounts);
    await act(async () => {
      root.render(<IntegrationsSection onSetUpSync={jest.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('does not render the removed Gmail integration as an available card', async () => {
    await renderSection([]);

    expect(container.querySelector('[data-integration-card="gmail"]')).toBeNull();
    expect(container.querySelector('[data-integration-card="google-calendar"]')).not.toBeNull();
  });

  it('ignores a leftover stored Gmail connection but keeps Google Calendar visible', async () => {
    await renderSection([
      { integrationId: 'gmail', accountId: 'gmail-1', accountLabel: 'Personal', metadata: {}, lastUsedAt: 1 },
      { integrationId: 'google-calendar', accountId: 'calendar-1', accountLabel: 'Personal', metadata: {}, lastUsedAt: 1 },
    ]);

    expect(container.querySelector('[data-integration-card="gmail"]')).toBeNull();
    expect(container.querySelector('[data-integration-card="google-calendar"]')).not.toBeNull();
  });
});
