import * as fs from 'fs';
import * as path from 'path';

const CARD_FILE = path.resolve(
  __dirname,
  '../../settings/components/integrations/IntegrationCard.tsx',
);

const cardSource = fs.readFileSync(CARD_FILE, 'utf-8');

describe('Integration connect flow contract', () => {
  it('connect flow launches directly without a consent modal gate', () => {
    expect(cardSource).not.toContain("import { IntegrationConsentModal }");
    expect(cardSource).not.toContain("Storage.get<boolean>(`integration_consent_${entry.id}`)");
    expect(cardSource).not.toContain('setConsentOpen(true)');
  });

  it('connect action still runs the OAuth flow', () => {
    expect(cardSource).toContain('await runOAuthFlow()');
  });

  it('token-paste integrations no longer persist a consent flag', () => {
    expect(cardSource).not.toContain('integration_consent_');
  });
});
