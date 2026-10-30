# Readwise Integration

## Purpose

The Readwise integration lets Bluetab save articles as Readwise highlights from direct AI verbs, mirror tab groups as one highlight per tab, and push Brain Dump entries into Readwise. It is a Tier 3 token-paste integration — there is no OAuth flow.

## Auth model — token paste

Readwise does not run an OAuth dance for client apps. Instead, the user copies a long-lived API token from the Readwise account page and pastes it into Bluetab's Settings panel.

- **Token instructions URL:** [`https://readwise.io/access_token`](https://readwise.io/access_token) (the registry exposes this as `token_paste_instructions_url` so the Settings paste form renders it as a clickable link).
- **Validation endpoint:** `GET https://readwise.io/api/v2/auth/` with `Authorization: Token ${token}`. A 204 response signals a valid token; 401 means the token is invalid or revoked. Bluetab calls this BEFORE storing the token bundle (RESEARCH §Pitfall 9) so the user gets immediate feedback instead of a delayed error on the first verb call.

## Authorization scheme — `Token`, NOT `Bearer`

Readwise uses the `Token` HTTP authorization scheme, not the more common `Bearer` scheme. Bluetab's adapter sets:

```
Authorization: Token <pasted_token>
```

A `Bearer` prefix would be rejected by Readwise with a 401. The XC-01 adapter test fixture explicitly asserts `Authorization` starts with `Token ` and does NOT contain `Bearer`.

## Token model

- Tokens are non-expiring. Registry sets `token_expiry_seconds: null` and `supports_refresh: false`.
- A 401 means the user revoked the token from their Readwise dashboard, in which case the dispatcher surfaces a reauth banner and the user pastes a fresh token.

## Rate limits

- Global rate limit: 240 requests per minute (4 requests per second). List endpoints are stricter at 20 per minute, but Bluetab does not currently use list endpoints.
- Registry uses `rate_limit_rps: 4`.
- The adapter throws the provider `Response` on 429 so the dispatcher reads `Retry-After` and backs off centrally.

## Verb endpoint shapes

### `save_article`

- **Endpoint:** `POST https://readwise.io/api/v2/highlights/`
- **Headers:** `Authorization: Token ${token}`, `Content-Type: application/json`
- **Body:** `{ highlights: [{ title, source_url, text, source_type: 'web', category: 'articles' }] }`
- **Result:** `{ savedCount }` (Readwise returns an array of created highlights).

### `send_group_to_readwise`

- Reads the remembered Bluetab group through `GroupMemoryStorageService` (XC-01).
- Saves one highlight per tab with `title = tab.title || tab.url`, `source_url = tab.url`, `text = tab.notes || tab.title`.
- Returns `{ created, errors }` aggregated across the per-tab calls. A 401 or 429 on any per-tab call propagates to the dispatcher so reauth and rate-limit handling stay centralized.

### `push_brain_dump_to_readwise`

- Reads a Brain Dump entry via `BrainDumpService.list()` (XC-01).
- Saves one highlight with `title = 'Brain dump'`, `source_url = entry.tabContext?.url || 'https://bluetab.app/brain-dump'`, `text = entry.text`. The fallback `source_url` is required because Readwise refuses highlights without a `source_url`.

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 OK | Returns normalized `{ success: true, result }` | Updates account last-used timestamp |
| 204 (validateToken only) | `validateToken` returns `true` | Token bundle stored after Settings paste |
| 401 | Throws provider `Response` from verb calls; `validateToken` returns `false` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- Group reads route through `GroupMemoryStorageService.getMemory`. Brain Dump reads route through `BrainDumpService.list`. No direct storage access.
- Tokens are managed centrally in `integration-token-storage.ts` (TOKEN-01) — never logged, never synced, never inlined into adapter code.
