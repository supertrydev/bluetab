# GitLab Integration

## Purpose

The GitLab integration lets Bluetab open GitLab issues from direct AI verbs, save remembered tab groups as one issue per tab, and push Brain Dump entries into a GitLab project. It is a Tier 4 pure-PKCE integration on the standard `chromiumapp.org` redirect.

## OAuth setup — pure PKCE (no client_secret, no bridge)

RESEARCH §Per-Integration Spec Tables Tier 4 explicitly confirms that gitlab.com supports PKCE without `client_secret` for public clients. Bluetab uses the standard PKCE dance directly — no Supertry bridge needed.

- **Authorize URL:** `https://gitlab.com/oauth/authorize`
- **Token URL:** `https://gitlab.com/oauth/token`
- **Scopes:** `api` (covers issues + repo write — GitLab does not split these into narrower scopes)
- **Redirect URI:** `https://<extension-id>.chromiumapp.org/` (returned by `chrome.identity.getRedirectURL()`)
- **Client type:** Public PKCE client. No `client_secret` in the extension.

## Token model

- Access tokens expire after 2 hours. The dispatcher refreshes them transparently using the issued `refresh_token`. `integration-token-storage.ts` is the single owner of refresh logic.
- A 401 response means the user revoked the application from their GitLab profile (Settings → Applications → Authorized applications → Revoke), or the refresh token aged out. The dispatcher surfaces a reauth banner and the user reconnects.

## Rate limits

- Global limit: 3600 requests per hour = 1 request per second average. Bluetab's `rate_limit_rps: 10` accommodates short bursts (e.g. send-group-to-gitlab on a 10-tab group) — GitLab's rate-limit window is rolling so brief 10-rps bursts inside an otherwise quiet hour do not trigger 429s.
- The adapter throws the provider `Response` on 429 so the dispatcher reads `Retry-After` and applies backoff centrally.

## Verb endpoint shapes

### `create_issue`

- **Endpoint:** `POST https://gitlab.com/api/v4/projects/${project_id}/issues`
- **Headers:** `Authorization: Bearer ${token}`, `Content-Type: application/json`
- **Body:** `{ title, description?, labels?, assignee_ids? }` — note that GitLab expects `labels` as a comma-separated string, not an array. The adapter joins `args.labels` (when provided as an array) before sending.
- **Result:** `{ issueIid, issueUrl }` (GitLab's per-project issue identifier is `iid`, distinct from the global `id`).

### `send_group_to_gitlab`

- Reads the remembered Bluetab group through `GroupMemoryStorageService` (XC-01 — never `chrome.storage.local` directly).
- Creates one issue per tab on the user-supplied `project_id` with `title = tab.title || tab.url` and `description = tab.url` (with `\n\n${tab.notes}` appended when present).

### `push_brain_dump_to_gitlab`

- Reads a Brain Dump entry via `BrainDumpService.list()` (XC-01).
- `title = entry.text.slice(0, 100)`. `description = entry.text` (with `\n\n${tabContext.url}` appended when present).

## Manual pull — NOT supported

GitLab is Tier 4 in Bluetab's tier model. Tier 4 integrations do not support `manual_pull` — that affordance is reserved for Tier 1 (Linear, Todoist, Notion, GitHub) where bidirectional state is part of the user's daily workflow. Registry sets `supports_manual_pull: false`.

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 201 Created | Returns normalized `{ success: true, result: { issueIid, issueUrl } }` | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- Group reads route through `GroupMemoryStorageService.getMemory`. Brain Dump reads route through `BrainDumpService.list`. No direct storage access.
- Tokens are managed centrally in `integration-token-storage.ts` (TOKEN-01) — never logged, never synced, never inlined into adapter code.
- The Supertry bridge is NOT used for GitLab — pure PKCE works.
