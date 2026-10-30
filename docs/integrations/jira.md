# Jira Integration

## Purpose

The Jira integration lets Bluetab create Jira issues from direct AI verbs, save remembered tab groups as one issue per tab, and push Brain Dump entries into a Jira project. It is a Tier 4 with-bridge integration (Atlassian 3LO via the Supertry bridge).

## OAuth via Supertry bridge (Atlassian 3LO)

Atlassian's 3LO OAuth requires `client_secret` at token exchange even with PKCE active, so the extension cannot complete the exchange itself. Bluetab generates the PKCE pair, runs interactive consent through `chrome.identity.launchWebAuthFlow`, then forwards the resulting `code` and `code_verifier` to the Supertry bridge endpoint:

- **Authorize URL:** `https://auth.atlassian.com/authorize`
- **Token endpoint (server-side, Supertry only):** `POST /v1/integrations/jira/exchange`
- **Refresh endpoint:** `POST /v1/integrations/jira/refresh` (Atlassian rotates `refresh_token` per refresh — Supertry forwards verbatim).
- **Bridge contract:** See `docs/integrations/SUPERTRY-BRIDGE-SPEC.md` §3 and §5.3 for the full request and response shape.

The adapter never calls the bridge directly. The bridge is invoked once per account at OAuth time by `integration-oauth-service.ts`. After that, the adapter only sees the access token returned by `getValidToken`.

## `cloud_id` + `site_url` metadata

Jira issues live on a specific Atlassian cloud site. Each site has a `cloud_id` (UUID) and a `site_url` (`https://yourteam.atlassian.net`). After token issuance, Supertry calls `GET https://api.atlassian.com/oauth/token/accessible-resources` to retrieve the list of cloud sites the user authorized and returns the first entry as metadata.

- `accountMeta.cloud_id` is used to construct the per-site API endpoint: `https://api.atlassian.com/ex/jira/${cloud_id}/rest/api/3/issue`.
- `accountMeta.site_url` is used to format the human-readable issue URL returned to Bluetab: `${site_url}/browse/${key}`.

If a user authorizes multiple cloud sites, Bluetab currently uses the first. A future UI may add a site picker.

## Scopes

- `write:jira-work` — create and update issues.
- `offline_access` — issue refresh tokens (Atlassian gates refresh tokens behind this scope).

## Token model

- Access tokens expire after 1 hour. The bridge refresh endpoint handles renewal transparently. `integration-token-storage.ts` is the single owner of refresh logic.
- A 401 response means the user revoked the integration in Atlassian's connected-apps panel or the refresh token aged out (Atlassian 3LO refresh-token TTL is normally 1 year). Bluetab surfaces a reauth banner and the user reconnects.

## Rate limits

- Atlassian per-product limits are generous (per-cloud-id throttling kicks in at much higher rates than Bluetab will ever drive).
- Registry uses `rate_limit_rps: 10`.
- The adapter throws the provider `Response` on 429 so the dispatcher reads `Retry-After` and applies backoff centrally.

## Verb endpoint shapes

### `create_issue`

- **Endpoint:** `POST https://api.atlassian.com/ex/jira/${cloud_id}/rest/api/3/issue`
- **Headers:** `Authorization: Bearer ${token}`, `Content-Type: application/json`, `Accept: application/json`
- **Body:** `{ fields: { project: { key }, summary, issuetype: { name: 'Task' }, description: <ADF doc> } }`
- **ADF body shape (RESEARCH §Pitfall):** Jira API v3 requires descriptions in Atlassian Document Format (ADF), not plain text. The adapter wraps the user's description in a single-paragraph ADF doc:
  ```json
  {
    "type": "doc",
    "version": 1,
    "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }]
  }
  ```
- **Result:** `{ issueKey, issueUrl }` where `issueUrl = ${site_url}/browse/${issueKey}`.

### `send_group_to_jira`

- Reads the remembered Bluetab group through `GroupMemoryStorageService` (XC-01 — never `chrome.storage.local` directly).
- Creates one issue per tab with `summary = tab.title || tab.url` and `description = tab.url` (with `\n\n${tab.notes}` appended when present).

### `push_brain_dump_to_jira`

- Reads a Brain Dump entry via `BrainDumpService.list()` (XC-01).
- `summary = entry.text.slice(0, 100)`. `description = entry.text` (with `\n\n${tabContext.url}` appended when present).

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 201 Created | Returns normalized `{ success: true, result: { issueKey, issueUrl } }` | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- Group reads route through `GroupMemoryStorageService.getMemory`. Brain Dump reads route through `BrainDumpService.list`. No direct storage access.
- Tokens are managed centrally in `integration-token-storage.ts` (TOKEN-01) — never logged, never synced, never inlined into adapter code.
