# Asana Integration

## Purpose

The Asana integration lets Bluetab create Asana tasks from direct AI verbs, save remembered tab groups as one task per tab, and push Brain Dump entries into an Asana workspace. It is a Tier 4 with-bridge integration (Asana OAuth via the Supertry bridge).

## OAuth via Supertry bridge

Asana's token endpoint requires `client_secret` even with PKCE active, so the extension cannot complete the exchange itself. Bluetab generates the PKCE pair, runs interactive consent through `chrome.identity.launchWebAuthFlow`, then forwards the resulting `code` and `code_verifier` to the Supertry bridge endpoint:

- **Authorize URL:** `https://app.asana.com/-/oauth_authorize`
- **Token endpoint (server-side, Supertry only):** `POST /v1/integrations/asana/exchange`
- **Refresh endpoint:** `POST /v1/integrations/asana/refresh` (Asana access tokens expire; the refresh token is used to obtain a new access token without user interaction).
- **Bridge contract:** See `docs/integrations/SUPERTRY-BRIDGE-SPEC.md` §3 and §5.4 for the full request and response shape.

The adapter never calls the bridge directly. The bridge is invoked once per account at OAuth time by `integration-oauth-service.ts`. After that, the adapter only sees the access token returned by `getValidToken`.

## `workspace_gid` metadata

Asana embeds the authenticated user's identity and workspace list directly in the token response (`data: { gid, name, email, workspaces: [{ gid, name }] }`). Supertry returns the first workspace's `gid` as `workspace_gid` in the metadata.

- `accountMeta.workspace_gid` is the default workspace gid used by every `create_task` call when the caller does not pass `args.workspace`.
- `args.workspace` overrides the default per-call, allowing the AI to target a specific workspace if the user has multiple connected.
- A future Bluetab UI may surface a workspace picker if multi-workspace use grows.

## Scope

- `default` — covers task and project read/write across the user's workspaces. Bluetab does not request narrower scopes because Asana does not expose granular OAuth scopes for task creation.

## Token model

- Asana OAuth access tokens are short-lived. Registry uses `token_expiry_seconds: 3600` as the fallback, and the bridge forwards provider `expires_in` when present.
- The bridge issues and stores a `refresh_token`; `getValidToken` refreshes through Supertry when the access token is near expiry.
- A 401 response after refresh attempts usually means the user revoked Bluetab inside their Asana settings or the refresh token was deauthorized. The dispatcher surfaces a reauth banner and the user reconnects.

## Rate limits

- Global limit: 1500 requests per minute = 25 requests per second.
- Registry uses `rate_limit_rps: 25`.
- The adapter throws the provider `Response` on 429 so the dispatcher reads `Retry-After` and applies backoff centrally.

## Verb endpoint shapes

### `create_task`

- **Endpoint:** `POST https://app.asana.com/api/1.0/tasks`
- **Headers:** `Authorization: Bearer ${token}`, `Content-Type: application/json`
- **Body shape:** Asana wraps every request and response in `{ data: ... }`:
  ```json
  {
    "data": {
      "name": "...",
      "notes": "...",
      "workspace": "<workspace_gid>",
      "projects": ["<project_gid>"]
    }
  }
  ```
- **Result:** `{ taskGid, taskUrl }` where `taskUrl = https://app.asana.com/0/0/${taskGid}`.

### `send_group_to_asana`

- Reads the remembered Bluetab group through `GroupMemoryStorageService` (XC-01 — never `chrome.storage.local` directly).
- Creates one task per tab with `name = tab.title || tab.url` and `notes = tab.url` (with `\n\n${tab.notes}` appended when present).

### `push_brain_dump_to_asana`

- Reads a Brain Dump entry via `BrainDumpService.list()` (XC-01).
- `name = entry.text.slice(0, 100)`. `notes = entry.text` (with `\n\n${tabContext.url}` appended when present).

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 201 Created | Returns normalized `{ success: true, result: { taskGid, taskUrl } }` | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- Group reads route through `GroupMemoryStorageService.getMemory`. Brain Dump reads route through `BrainDumpService.list`. No direct storage access.
- Tokens are managed centrally in `integration-token-storage.ts` (TOKEN-01) — never logged, never synced, never inlined into adapter code.
