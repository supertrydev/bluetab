/**
 * URL redaction tests (MCP-04).
 *
 * Plan 13-04 turns these RED-as-todo stubs (Plan 13-01) into live
 * assertions. The function MUST strip sensitive query-param values
 * (replace with the literal `[REDACTED]`) for case-insensitive matches
 * against the canonical sensitive set + common prefix/suffix variants,
 * and MUST preserve everything else about the URL (scheme, host, path,
 * fragment, ordering, non-sensitive params).
 */

import { redactSensitiveParams } from '../url-redaction';

const REDACTED = '[REDACTED]';

/**
 * URLSearchParams.set encodes square brackets to `%5B...%5D`. The
 * snapshot reader cares about the literal value being unguessable, so
 * we accept both shapes but normalize for assertion clarity.
 */
function decode(url: string): string {
  return url.replace(/%5B/gi, '[').replace(/%5D/gi, ']');
}

describe('redactSensitiveParams (MCP-04) — sensitive query parameters are stripped', () => {
  it('strips access_token + session, keeps non-sensitive params (ref=foo)', () => {
    const out = decode(
      redactSensitiveParams('https://example.com/page?access_token=abc&ref=foo&session=xyz'),
    );
    expect(out).toContain(`access_token=${REDACTED}`);
    expect(out).toContain(`session=${REDACTED}`);
    expect(out).toContain('ref=foo');
    expect(out).not.toContain('access_token=abc');
    expect(out).not.toContain('session=xyz');
  });

  it('case-insensitive: AccessToken, ACCESS_TOKEN, access_TOKEN all redacted', () => {
    const inputs = [
      'https://example.com/?AccessToken=abc',
      'https://example.com/?ACCESS_TOKEN=abc',
      'https://example.com/?access_TOKEN=abc',
    ];
    for (const input of inputs) {
      const out = decode(redactSensitiveParams(input));
      expect(out).toContain(`=${REDACTED}`);
      expect(out).not.toContain('=abc');
    }
  });

  it('redacts canonical singletons: token, session, key, password, auth, code, secret', () => {
    const params = ['token', 'session', 'key', 'password', 'auth', 'code', 'secret'];
    for (const p of params) {
      const out = decode(redactSensitiveParams(`https://example.com/?${p}=value123`));
      expect(out).toContain(`${p}=${REDACTED}`);
      expect(out).not.toContain('=value123');
    }
  });

  it('redacts canonical singletons: bearer, credential, csrf, xsrf, jwt, oauth, signature', () => {
    const params = ['bearer', 'credential', 'csrf', 'xsrf', 'jwt', 'oauth', 'signature'];
    for (const p of params) {
      const out = decode(redactSensitiveParams(`https://example.com/?${p}=value123`));
      expect(out).toContain(`${p}=${REDACTED}`);
      expect(out).not.toContain('=value123');
    }
  });

  it('redacts compound forms: apikey, api_key, access_token, refresh_token, id_token', () => {
    const params = ['apikey', 'api_key', 'access_token', 'refresh_token', 'id_token'];
    for (const p of params) {
      const out = decode(redactSensitiveParams(`https://example.com/?${p}=value123`));
      expect(out).toContain(`${p}=${REDACTED}`);
      expect(out).not.toContain('=value123');
    }
  });

  it('redacts canonical singletons: session_id, sid, passwd, pwd', () => {
    const params = ['session_id', 'sid', 'passwd', 'pwd'];
    for (const p of params) {
      const out = decode(redactSensitiveParams(`https://example.com/?${p}=value123`));
      expect(out).toContain(`${p}=${REDACTED}`);
      expect(out).not.toContain('=value123');
    }
  });

  it('matches with prefix and suffix variants: x_token, my_session_id, oauth_signature', () => {
    const samples: Array<[string, string]> = [
      ['x_token', 'abc'],
      ['my_session_id', 'sess'],
      ['oauth_signature', 'sig'],
      ['custom_auth_header', 'bearer-thing'],
    ];
    for (const [param, value] of samples) {
      const out = decode(redactSensitiveParams(`https://example.com/?${param}=${value}`));
      expect(out).toContain(`${param}=${REDACTED}`);
      expect(out).not.toContain(`${param}=${value}`);
    }
  });

  it('preserves non-sensitive parameters verbatim', () => {
    const url = 'https://example.com/path?utm_source=newsletter&ref=home&page=2';
    const out = redactSensitiveParams(url);
    expect(out).toContain('utm_source=newsletter');
    expect(out).toContain('ref=home');
    expect(out).toContain('page=2');
  });

  it('preserves non-param URL components: scheme, host, path, fragment', () => {
    const url = 'https://example.com/some/long/path?token=abc#section-2';
    const out = decode(redactSensitiveParams(url));
    expect(out).toMatch(/^https:\/\/example\.com\/some\/long\/path/);
    expect(out).toContain('#section-2');
    expect(out).toContain(`token=${REDACTED}`);
  });

  it('returns malformed URL unchanged (no throw)', () => {
    const malformed = 'not a url at all';
    expect(redactSensitiveParams(malformed)).toBe(malformed);

    const jaggedSchemeOnly = 'foo://';
    // foo:// is technically parseable; non-throw is the contract.
    expect(() => redactSensitiveParams(jaggedSchemeOnly)).not.toThrow();
  });

  it('preserves param presence after replacement (no params dropped)', () => {
    const url = 'https://example.com/?a=1&token=secret&b=2&session=xyz&c=3';
    const out = decode(redactSensitiveParams(url));
    // All five param names still appear.
    expect(out).toContain('a=1');
    expect(out).toContain(`token=${REDACTED}`);
    expect(out).toContain('b=2');
    expect(out).toContain(`session=${REDACTED}`);
    expect(out).toContain('c=3');
  });

  it('does not mangle path segments (token-in-path is preserved verbatim — out of scope for v3.0)', () => {
    // Deliberate: path-segment redaction is not part of MCP-04 in v3.0.
    // Most modern OAuth flows use query-string or POST body.
    const url = 'https://example.com/oauth/token/some-path-token-value?ref=home';
    const out = redactSensitiveParams(url);
    expect(out).toContain('/oauth/token/some-path-token-value');
    expect(out).toContain('ref=home');
  });

  it('handles URLs with no query params (returns input unchanged)', () => {
    const url = 'https://example.com/path';
    expect(redactSensitiveParams(url)).toBe(url);
  });
});
