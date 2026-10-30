import { renderToStaticMarkup } from 'react-dom/server';
import { initI18n } from '@/i18n';
import { ConnectedClientCard } from './ConnectedClientCard';

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);

function renderLastUsed(lastUsedAt: number): string {
  return renderToStaticMarkup(
    <ConnectedClientCard
      client={{
        id: 'client-1',
        name: 'Cursor',
        authMode: 'oauth',
        lastUsedAt,
      }}
      allowedToolsets={[]}
      mcpUrl="https://mcp.example.test"
      authToken={null}
      onRotatePersonalToken={jest.fn()}
      onRefresh={jest.fn()}
    />,
  );
}

describe('ConnectedClientCard relative time', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['minutes', NOW - 5 * 60_000, '5 min ago'],
    ['hours', NOW - 3 * 60 * 60_000, '3h ago'],
    ['days', NOW - 2 * 24 * 60 * 60_000, '2 days ago'],
  ])('renders translated %s-ago copy', (_range, lastUsedAt, expected) => {
    expect(renderLastUsed(lastUsedAt)).toContain(`>${expected}<`);
  });
});
