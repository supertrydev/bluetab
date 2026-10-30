/**
 * integration-pkce-helper.test.ts — GREEN on landing (Plan 14-01 Task 1).
 *
 * Contract: generatePKCE() returns {verifier, challenge}; verifier matches
 * /^[A-Za-z0-9_-]{43}$/; challenge is base64url SHA-256 of verifier;
 * multiple calls produce different verifiers.
 */

import { generatePKCE } from '../../services/integration-oauth-service';

describe('generatePKCE — PKCE code_verifier + code_challenge helper', () => {
  it('returns an object with verifier and challenge', async () => {
    const result = await generatePKCE();
    expect(result).toHaveProperty('verifier');
    expect(result).toHaveProperty('challenge');
  });

  it('verifier matches /^[A-Za-z0-9_-]{43,128}$/ (RFC 7636 length)', async () => {
    const { verifier } = await generatePKCE();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('challenge is a base64url string (no padding, no + or /)', async () => {
    const { challenge } = await generatePKCE();
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain('=');
    expect(challenge).not.toContain('+');
    expect(challenge).not.toContain('/');
  });

  it('multiple calls produce different verifiers', async () => {
    const [a, b] = await Promise.all([generatePKCE(), generatePKCE()]);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('multiple calls produce different challenges', async () => {
    const [a, b] = await Promise.all([generatePKCE(), generatePKCE()]);
    expect(a.challenge).not.toBe(b.challenge);
  });
});
