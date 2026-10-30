/**
 * @module utils/url-redaction
 *
 * WHY:  MCP-04 mandates that every URL in the MCP snapshot push (and
 *       every URL referenced by an MCP tool response) is stripped of
 *       sensitive query-parameter values BEFORE it leaves the extension.
 *       Bluetab cannot trust that an external agent (or its surrounding
 *       transport, log, or analytics layer) will redact tokens itself —
 *       so we redact at the source.
 *
 * WHAT: redactSensitiveParams(rawUrl) — given a string URL, returns the
 *       same URL with the value of every "sensitive" query parameter
 *       replaced by the literal string `[REDACTED]`. Param key names are
 *       matched case-insensitively against the SENSITIVE_PARAM_REGEX;
 *       prefix and suffix variants (e.g. `x_token`, `oauth_signature`)
 *       are also caught. Non-sensitive params, the URL scheme, host,
 *       path, and fragment are preserved verbatim. Malformed URLs are
 *       returned unchanged (defensive — the snapshot path must never
 *       throw).
 *
 * HOW:  Single regex compiled once at module load. URLSearchParams.set
 *       handles re-encoding without mangling other params. The regex is
 *       wrapped in `(.*_)?...(_.*)?` so prefix and suffix variants
 *       around the canonical word match too — `access_token`, `x-csrf`,
 *       `my_session_id`, `oauth_signature`. The MCP-server-service
 *       buildSnapshot path calls this on every tab URL and every
 *       brain-dump captured-tab-context URL before the payload is
 *       gzipped and POSTed.
 *
 * NOT:  Does not perform path-segment redaction — sensitive material in
 *       a path segment (e.g. `/oauth/token/abc123`) is NOT stripped.
 *       The mitigation strategy is "no token-in-path; if a server uses
 *       token-in-path we add path-segment matching in v3.1." Today's
 *       OAuth providers all use query params or POST bodies.
 *       Does not perform fragment redaction — fragments never reach the
 *       server and are out of scope for snapshot serialization.
 *       Does not de-duplicate tracking parameters (utm_*, ref, etc.) —
 *       those are not "sensitive" in the credential-leak sense; they
 *       are user-visible navigation state and stay in the snapshot.
 */

/**
 * Match any of the canonical sensitive words with any prefix/suffix
 * around them. The `i` flag handles case-insensitivity for the simple
 * lowercase / UPPERCASE / snake_case forms; for camelCase (e.g.
 * `AccessToken`, `apiKey`), the literal canonical word still appears
 * inside the key (matched substring), so a non-anchored regex catches
 * those too. Anchoring the alternation ONLY at word boundaries would
 * miss `AccessToken` (no `_` between `Access` and `Token`).
 *
 * The non-anchored design is acceptable because the sensitive word
 * list is curated and unlikely to false-positive on user content
 * (param NAMES are not user content; they are author/dev choices).
 */
const SENSITIVE_PARAM_REGEX =
  /(token|session|key|password|passwd|pwd|auth|code|secret|credential|bearer|csrf|xsrf|apikey|api_key|access_token|refresh_token|id_token|session_id|sid|jwt|oauth|signature)/i;

/**
 * Strip the values of sensitive query parameters from a URL.
 *
 * @param rawUrl - The URL to redact
 * @returns The URL with sensitive param values replaced by `[REDACTED]`,
 *          or the input unchanged if it cannot be parsed as a URL.
 */
export function redactSensitiveParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const params = url.searchParams;
    // Collect first to avoid mutating the iterator.
    const toRedact: string[] = [];
    for (const key of params.keys()) {
      if (SENSITIVE_PARAM_REGEX.test(key)) {
        toRedact.push(key);
      }
    }
    if (toRedact.length === 0) return url.toString();
    for (const key of toRedact) {
      params.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}
