# Notion Integration

## Purpose

The Notion integration lets Bluetab create Notion pages from direct AI verbs, save groups as pages or database rows, and push Brain Dump entries into a Notion workspace. It is a Tier 1 with-bridge integration (OAuth via Supertry bridge) and supports manual pull for recently edited database rows.

## OAuth via Supertry bridge

Notion's token endpoint requires HTTP Basic Auth with `client_id:client_secret` (base64 encoded), so the extension cannot complete the exchange itself. Bluetab generates the PKCE pair, runs interactive consent through `chrome.identity.launchWebAuthFlow`, then forwards the resulting `code` and `code_verifier` to the Supertry bridge endpoint:

- **Authorize URL:** `https://api.notion.com/v1/oauth/authorize`
- **Token endpoint (server-side, Supertry only):** `POST /v1/integrations/notion/exchange`
- **Refresh endpoint:** Not used. Notion does not issue refresh tokens.
- **Bridge contract:** See `docs/integrations/SUPERTRY-BRIDGE-SPEC.md` §3 and §5 for the full request and response shape, and §5 for the Notion-specific exchange notes (HTTP Basic Auth pitfall).

The adapter never calls the bridge directly. The bridge is invoked once per account at OAuth time by `integration-oauth-service.ts`. After that, the adapter only sees the access token returned by `getValidToken`.

## Capabilities model

Notion uses a capabilities model (not OAuth scopes). Capabilities are configured on the public integration page in the Notion developer console and apply to every workspace that installs the integration. Bluetab requests the minimum capabilities needed to create pages, append database rows, and read pages the workspace owner has shared with the integration.

## Token model

Notion access tokens are non-expiring per workspace. The bundle stores `expires_at` as a far-future sentinel because the dispatcher requires the field. There is no refresh token.

A 401 response always means the user revoked Bluetab inside their Notion settings or removed the workspace permission. The adapter throws the provider `Response` so the dispatcher can flag the reauth banner centrally; the user must reconnect the workspace.

## Rate limits

Notion enforces a soft limit of 3 requests per second average with a small burst budget of about 10 requests. Bluetab uses a conservative `rate_limit_rps: 2` in the registry. The adapter throws the provider `Response` on 429 so the dispatcher can read `Retry-After` and back off.

## Verb endpoint shapes

### `create_page`

- **Endpoint:** `POST https://api.notion.com/v1/pages`
- **Headers:** `Authorization: Bearer ${token}`, `Notion-Version: 2022-06-28`, `Content-Type: application/json`
- **Body:** `{ parent: {page_id|database_id|workspace}, properties: {title: [{text: {content: title}}]}, children: [...] | [] }`
- **Result:** `{ pageId, pageUrl }`

### `append_to_database`

- **Endpoint:** `POST https://api.notion.com/v1/pages`
- **Body:** `{ parent: {database_id}, properties: {...}, children?: [...] }`
- **Note:** The properties object must match the database schema. The adapter passes properties through verbatim so callers control schema mapping.
- **Result:** `{ pageId, pageUrl }`

### `send_group_to_notion`

- Reads a remembered Bluetab group through `GroupMemoryStorageService`.
- For database parents, creates one row per tab with `Name = tab.title` and a paragraph child block holding the URL and notes.
- For page parents, creates one child page per tab with the tab title and a paragraph child block.

### `push_brain_dump_to_notion`

- Reads a Brain Dump entry through `BrainDumpService.list()`.
- Title is the first 100 characters of the entry text.
- Content is the entry text plus the captured tab URL when available.

## Manual pull semantics

Manual pull calls `POST https://api.notion.com/v1/databases/${default_database_id}/query`. When `since` is provided the adapter filters by `timestamp: 'last_edited_time'` with `last_edited_time: { after: <ISO> }`. When `since` is omitted the body is `{}` (entire database).

The adapter returns normalized records `{ id, properties, last_edited_time: number, url }` where `last_edited_time` is epoch milliseconds.

## Workspace metadata

Captured by Supertry at OAuth time and stored in the token bundle metadata:

- `workspace_id` — required for routing and audit
- `workspace_name` — user-visible label
- `bot_id` — Notion bot identifier for the integration install
- `default_database_id` (optional) — set later if the user picks a database for manual pull

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 with page or query data | Returns normalized result | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally (workspace revoked or permission changed) |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details through dispatcher error handling |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- The adapter never calls the Supertry bridge. The bridge is auth-time only.
- Group and Brain Dump reads route through existing service helpers.
- `pullFromIntegration` remains UI-only and is not registered as an AI verb.
