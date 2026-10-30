/** @jest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IntegrationCard } from './IntegrationCard';
import { getRegistryEntry } from '@/services/integrations/registry';
import type { IntegrationId } from '@/services/integrations/registry';
import type { IntegrationAccount } from '@/types/integrations';
import { OAuthProviderUnreachableError } from '@/services/oauth-errors';
import { isolateBidi } from '@/i18n/bidi';

const mockLaunchOAuthFlow = jest.fn();
const mockEncryptionReady = jest.fn();
const mockToastError = jest.fn();
const mockTabsCreate = jest.fn();

function visibleText(): string {
  return (document.body.textContent ?? '').replace(/[\u2066-\u2069]/g, '');
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => {
      if (key === 'common.connect') return 'Connect';
      if (key === 'settings.integrations.connecting') return 'Connecting';
      if (key === 'settings.integrations.notConnected') return 'Not connected';
      if (key === 'settings.integrations.connected') return 'Connected';
      if (key === 'settings.integrations.connectedChannel') return 'Connected channel';
      if (key === 'settings.integrations.selectedDiscordChannel') return 'Discord channel selected';
      if (key === 'settings.integrations.connectError') return `Could not connect ${options?.name}`;
      if (key === 'settings.integrations.oauthNetworkErrorTitle') {
        return `${options?.name} could not be reached`;
      }
      if (key === 'settings.integrations.oauthNetworkErrorDescription') {
        return `Your device could not resolve ${options?.name}’s address. Check your internet, DNS, VPN, or Secure DNS settings, then try again.`;
      }
      if (key === 'settings.integrations.oauthNetworkErrorTryAgain') return 'Try again';
      if (key === 'settings.integrations.oauthNetworkErrorLearnMore') return 'Learn more';
      if (key === 'components.integrations.syncSetupTitle') return 'Set up Sync to connect integrations';
      if (key === 'components.integrations.syncSetupDescription') {
        return 'Bluetab encrypts integration connections on this device. Complete Sync setup once to continue.';
      }
      if (key === 'components.integrations.syncSetupConfirm') return 'Set up Sync';
      if (key === 'options.manager.organizeDialog.notNow') return 'Not now';
      if (key === 'common.close') return 'Close';
      return key;
    },
  }),
}));

jest.mock('@/components/Toast', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

jest.mock('@/services/integration-oauth-service', () => ({
  launchOAuthFlow: (...args: unknown[]) => mockLaunchOAuthFlow(...args),
}));

jest.mock('@/services/integration-token-storage', () => ({
  addAccount: jest.fn(),
  isIntegrationEncryptionReady: () => mockEncryptionReady(),
}));

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
  },
}));

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return match;
}

async function click(target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('IntegrationCard Sync setup preflight', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  const onAccountsChange = jest.fn();
  const onSetUpSync = jest.fn();

  async function renderCard(
    integrationId: IntegrationId = 'linear',
    accounts: IntegrationAccount[] = [],
  ) {
    const entry = getRegistryEntry(integrationId);
    if (!entry) throw new Error(`${integrationId} registry entry is required for this test`);

    await act(async () => {
      root.render(
        <IntegrationCard
          entry={entry}
          accounts={accounts}
          onAccountsChange={onAccountsChange}
          onSetUpSync={onSetUpSync}
        />,
      );
    });
  }

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          getURL: (path: string) => `chrome-extension://test/${path}`,
        },
        tabs: {
          create: (...args: unknown[]) => mockTabsCreate(...args),
        },
        storage: {
          onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn(),
          },
        },
      },
    });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLaunchOAuthFlow.mockReset();
    mockEncryptionReady.mockReset();
    mockToastError.mockReset();
    mockTabsCreate.mockReset();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    consoleErrorSpy.mockRestore();
  });

  it.each<IntegrationId>(['linear', 'notion'])(
    'shows Sync setup guidance and never launches %s OAuth when encryption is unavailable',
    async (integrationId) => {
      mockEncryptionReady.mockResolvedValue(false);
      await renderCard(integrationId);

      await click(button('Connect'));

      expect(document.body.textContent).toContain('Set up Sync to connect integrations');
      expect(document.body.textContent).toContain(
        'Bluetab encrypts integration connections on this device. Complete Sync setup once to continue.',
      );
      expect(mockLaunchOAuthFlow).not.toHaveBeenCalled();

      await click(button('Not now'));
      expect(document.body.textContent).not.toContain('Set up Sync to connect integrations');
    },
  );

  it('routes the modal primary action to the existing Sync setup UI', async () => {
    mockEncryptionReady.mockResolvedValue(false);
    await renderCard();

    await click(button('Connect'));
    await click(button('Set up Sync'));

    expect(onSetUpSync).toHaveBeenCalledTimes(1);
    expect(mockLaunchOAuthFlow).not.toHaveBeenCalled();
  });

  it('launches OAuth when Sync encryption is ready', async () => {
    mockEncryptionReady.mockResolvedValue(true);
    mockLaunchOAuthFlow.mockResolvedValue({});
    await renderCard();

    await click(button('Connect'));

    expect(mockLaunchOAuthFlow).toHaveBeenCalledWith('linear');
    expect(onAccountsChange).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('Set up Sync to connect integrations');
  });

  it.each<[IntegrationId, string]>([
    ['discord', 'Discord'],
    ['notion', 'Notion'],
  ])(
    'shows provider-aware network guidance when %s auth navigation cannot load',
    async (integrationId, providerName) => {
      mockEncryptionReady.mockResolvedValue(true);
      mockLaunchOAuthFlow.mockRejectedValueOnce(
        new OAuthProviderUnreachableError(
          providerName,
          new Error('Authorization page could not be loaded.'),
        ),
      );
      await renderCard(integrationId);

      await click(button('Connect'));

      expect(visibleText()).toContain(`${providerName} could not be reached`);
      expect(visibleText()).toContain(
        `Your device could not resolve ${providerName}’s address. Check your internet, DNS, VPN, or Secure DNS settings, then try again.`,
      );
      expect(mockToastError).not.toHaveBeenCalled();
    },
  );

  it('retries the same provider from the network guidance modal', async () => {
    mockEncryptionReady.mockResolvedValue(true);
    mockLaunchOAuthFlow
      .mockRejectedValueOnce(
        new OAuthProviderUnreachableError(
          'Discord',
          new Error('net::ERR_NAME_NOT_RESOLVED'),
        ),
      )
      .mockResolvedValueOnce({});
    await renderCard('discord');

    await click(button('Connect'));
    await click(button('Try again'));

    expect(mockLaunchOAuthFlow).toHaveBeenNthCalledWith(1, 'discord');
    expect(mockLaunchOAuthFlow).toHaveBeenNthCalledWith(2, 'discord');
    expect(onAccountsChange).toHaveBeenCalledTimes(1);
    expect(visibleText()).not.toContain('Discord could not be reached');
  });

  it('opens browser network settings from Learn more without changing DNS automatically', async () => {
    mockEncryptionReady.mockResolvedValue(true);
    mockLaunchOAuthFlow.mockRejectedValueOnce(
      new OAuthProviderUnreachableError(
        'Discord',
        new Error('Authorization page could not be loaded.'),
      ),
    );
    await renderCard('discord');

    await click(button('Connect'));
    await click(button('Learn more'));

    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'chrome://settings/security' });
    expect(mockLaunchOAuthFlow).toHaveBeenCalledTimes(1);
    expect(visibleText()).not.toContain('Discord could not be reached');
  });

  it.each([
    'Cloud OAuth callback failed (503)',
    'The user did not approve access.',
  ])('does not show DNS guidance for %s', async (message) => {
    mockEncryptionReady.mockResolvedValue(true);
    mockLaunchOAuthFlow.mockRejectedValueOnce(new Error(message));
    await renderCard('discord');

    await click(button('Connect'));

    expect(visibleText()).not.toContain('Discord could not be reached');
    expect(mockToastError).toHaveBeenCalledWith(
      `Could not connect ${isolateBidi('Discord')}`,
      { description: isolateBidi(message) },
    );
  });

  it('shows a trusted Discord channel name without exposing raw channel or server ids', async () => {
    await renderCard('discord', [{
      integrationId: 'discord',
      accountId: 'discord-account-1',
      accountLabel: 'Discord',
      metadata: {
        webhook_channel_name: 'general',
        webhook_channel_id: '190320984123768832',
        guild_id: '657320984123768111',
      },
      lastUsedAt: 0,
      connectionKind: 'cloud_reference',
    }]);

    expect(document.body.textContent).toContain('#general');
    expect(container.innerHTML).not.toContain('190320984123768832');
    expect(container.innerHTML).not.toContain('657320984123768111');
    expect(document.body.textContent).not.toContain('Server ');
    expect(document.body.textContent).not.toContain('ID ');
  });

  it('uses a safe fallback and never presents the webhook name as the channel name', async () => {
    await renderCard('discord', [{
      integrationId: 'discord',
      accountId: 'discord-account-1',
      accountLabel: 'Discord',
      metadata: {
        webhook_name: 'Bluetab Webhook',
        webhook_channel_id: '190320984123768832',
        guild_id: '657320984123768111',
      },
      lastUsedAt: 0,
      connectionKind: 'cloud_reference',
    }]);

    expect(document.body.textContent).toContain('Discord channel selected');
    expect(document.body.textContent).not.toContain('#Bluetab Webhook');
    expect(container.innerHTML).not.toContain('190320984123768832');
    expect(container.innerHTML).not.toContain('657320984123768111');
  });
});
