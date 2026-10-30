# Trello Integration

## Purpose

The Trello integration lets Bluetab create Trello cards on a board list from direct AI verbs, mirror tab groups as one card per tab, and push Brain Dump entries into a Trello list. It is a Tier 4 token-paste integration that uses Trello's `/1/authorize` redirect-intercept pattern (RESEARCH §Pitfall 12) — there is no client-credentials OAuth dance.

## Auth model — token paste via `/1/authorize` redirect intercept (Pitfall 12)

Trello's full OAuth implementation is OAuth 1.0a, which is incompatible with PKCE and awkward to implement client-side. Trello also exposes a simpler path: the `/1/authorize` endpoint with `response_type=token` returns a long-lived access token in the URL FRAGMENT after the user approves the integration. Bluetab uses this simpler path and classifies it as `auth_type: 'token_paste'` with a `trello_redirect_intercept: true` marker.

- **Authorize URL:** `https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=<PUBLIC_API_KEY>&return_url=<chromium app redirect>`
- **Token return:** The redirect URL ends with `#token=<access_token>` in the **fragment**, not the query string. `integration-oauth-service.ts` has a dedicated `launchTrelloRedirectIntercept` branch that parses `new URL(redirectUrl).hash.slice(1)` as `URLSearchParams` to extract the token.
- **No exchange step:** Because the token is already in the redirect, no token-endpoint POST happens. The bundle is constructed directly from the fragment with `expires_at = Number.MAX_SAFE_INTEGER` (because the authorize URL uses `expiration=never`).
- **Public API key:** Trello's "key" is a publicly visible app identifier — not a secret. It is registered as `oauth_client_id` in the registry so the same UI plumbing applies, but it does NOT need `PUBLIC_OAUTH2_CLIENT` or any of the other public-PKCE-client gating that Slack uses. The matching pair on every API call is `?key=<PUBLIC_KEY>&token=<USER_TOKEN>`.

The user never copy-pastes a token manually for Trello — the `token_paste` classification captures the "no PKCE token-endpoint exchange" semantics, not the UX. The Settings panel still launches `chrome.identity.launchWebAuthFlow` for Trello.

## Token model

- Access tokens are non-expiring because the authorize URL specifies `expiration=never`. Registry sets `token_expiry_seconds: null` and `supports_refresh: false`.
- A 401 means the user revoked the token from their Trello account settings (Trello → Power-Ups → Revoke). The dispatcher surfaces a reauth banner and the user reconnects.

## Auth on every API call — query string, NOT Authorization header

Trello does not honor `Authorization: Bearer <token>`. Every API call carries the public API key and the user token as query string parameters:

```
POST https://api.trello.com/1/cards?key=<PUBLIC_API_KEY>&token=<USER_TOKEN>
Content-Type: application/json
```

The adapter test fixture explicitly asserts `Authorization` header is undefined and `key=` + `token=mock-tok` are present in the URL.

## Rate limits

- Per-token limit: 100 requests per 10 seconds = 10 requests per second.
- Registry uses `rate_limit_rps: 10`.
- The adapter throws the provider `Response` on 429 so the dispatcher reads `Retry-After` and applies backoff centrally.

## Verb endpoint shapes

### `create_card`

- **Endpoint:** `POST https://api.trello.com/1/cards?key=<PUBLIC_KEY>&token=<USER_TOKEN>`
- **Headers:** `Content-Type: application/json` (NO `Authorization` header)
- **Body:** `{ idList, name, desc?, idLabels?, due? }`
- **Result:** `{ cardId, cardUrl }`

### `send_group_to_trello`

- Reads the remembered Bluetab group through `GroupMemoryStorageService` (XC-01 — never `chrome.storage.local` directly).
- Creates one card per tab on the user-supplied `idList` with `name = tab.title || tab.url` and `desc = tab.url` (with `\n\n${tab.notes}` appended when present).

### `push_brain_dump_to_trello`

- Reads a Brain Dump entry via `BrainDumpService.list()` (XC-01).
- `name = entry.text.slice(0, 200)`. `desc = entry.text` (with `\n\n${tabContext.url}` appended when present).

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 OK | Returns normalized `{ success: true, result: { cardId, cardUrl } }` | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- Group reads route through `GroupMemoryStorageService.getMemory`. Brain Dump reads route through `BrainDumpService.list`. No direct storage access.
- Tokens are managed centrally in `integration-token-storage.ts` (TOKEN-01) — never logged, never synced, never inlined into adapter code.
- The Supertry bridge is NOT used for Trello. The `/1/authorize` redirect-intercept path makes the bridge unnecessary — see `docs/integrations/SUPERTRY-BRIDGE-SPEC.md` §1 Trello note.
