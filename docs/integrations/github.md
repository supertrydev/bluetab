# GitHub Integration

## Purpose

The GitHub integration lets Bluetab open issues and gists from direct AI verbs and push Brain Dump entries into GitHub as either an issue or a gist. Groups are intentionally not GitHub-scoped (no group menu entry). It is a Tier 1 with-bridge integration (OAuth via Supertry bridge) and supports manual pull for recently updated issues in a chosen repository.

## OAuth via Supertry bridge

GitHub added PKCE in July 2025, but the token endpoint still requires `client_secret`. GitHub does not distinguish public from confidential OAuth clients, so the secret cannot ship in the extension. Bluetab generates the PKCE pair, runs interactive consent through `chrome.identity.launchWebAuthFlow`, and forwards the resulting `code` plus `code_verifier` to the Supertry bridge:

- **Authorize URL:** `https://github.com/login/oauth/authorize`
- **Token endpoint (server-side, Supertry only):** `POST /v1/integrations/github/exchange`
- **Refresh endpoint:** Used only when the GitHub admin enables an expiration policy. By default GitHub access tokens are non-expiring.
- **Bridge contract:** See `docs/integrations/SUPERTRY-BRIDGE-SPEC.md` §3 and §5.2 for the full request and response shape, including the GitHub form-body and `Accept: application/json` requirements.

The adapter never calls the bridge directly. The bridge is invoked once per account at OAuth time by `integration-oauth-service.ts`. After that, the adapter only sees the access token returned by `getValidToken`.

## Repo scope

Bluetab requests the `repo` scope only. This is the minimum scope that lets the integration:

- Create issues in repositories the user owns or collaborates on
- Create public or secret gists owned by the authenticated user
- Read issue lists for manual pull

The `repo` scope grants read and write across the user's repositories. Bluetab does not write commits, branches, releases, or pull requests, even though the scope would technically permit it. If the GitHub admin restricts the OAuth app to a subset of repositories, the user is prompted at consent time and Bluetab inherits that restriction automatically.

## Token model

GitHub access tokens are non-expiring by default. The token bundle stores `expires_at` as a far-future sentinel because the dispatcher requires the field. There is no refresh token unless the GitHub admin enabled an expiration policy on the OAuth app — when that policy is on, GitHub returns `expires_in` plus a `refresh_token` and the bridge forwards both fields verbatim.

A 401 response always means the user revoked the OAuth app from `https://github.com/settings/applications`, the admin policy expired the token, or the user removed `repo` access. The adapter throws the provider `Response` so the dispatcher can flag the reauth banner centrally.

## Rate limits

GitHub's authenticated REST API allows 5000 requests per hour per user (~1.39 requests per second). Bluetab uses a conservative `rate_limit_rps: 1` in the registry to stay well below the budget under bursts. The adapter throws the provider `Response` on 429 so the dispatcher can read `Retry-After` and back off.

## Verb endpoint shapes

### `create_issue`

- **Endpoint:** `POST https://api.github.com/repos/${owner}/${repo}/issues`
- **Headers:** `Authorization: Bearer ${token}`, `Accept: application/vnd.github+json`, `Content-Type: application/json`
- **Body:** `{ title, body?, labels?, assignees? }`
- **Result:** `{ issueId, issueNumber, issueUrl }`

### `create_gist`

- **Endpoint:** `POST https://api.github.com/gists`
- **Body:** `{ description?, public, files: { "<filename>": { content } } }`
- **Default:** `public` defaults to `false` when omitted.
- **Result:** `{ gistId, gistUrl }`

### `push_brain_dump_to_github`

- Reads a Brain Dump entry through `BrainDumpService.list()`.
- When `kind: 'issue'` (default), creates an issue with title = first 100 characters of the entry text and body = entry text plus optional captured tab URL.
- When `kind: 'gist'`, creates a private gist with the same content saved as `brain-dump-${entryId}.md`.

## Manual pull semantics

Manual pull calls `GET https://api.github.com/repos/${default_owner}/${default_repo}/issues?since=<ISO>&state=all` when `since` is provided, or `?state=all` alone when `since` is omitted. The adapter returns normalized records `{ id, number, title, body, state, updatedAt: number }` where `updatedAt` is epoch milliseconds.

## Account metadata

Captured by Supertry at OAuth time (per `SUPERTRY-BRIDGE-SPEC.md` §5.2):

- `login` — GitHub username for the authenticated user
- `scope` — granted scopes string (currently `repo`)

Per-call routing details — `owner`, `repo`, gist `public` flag — are passed at verb call time, not stored as metadata. Manual pull stores `default_owner` and `default_repo` in the account metadata once the user picks a repository for periodic pulls.

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 / 201 with issue or gist data | Returns normalized result | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally (token revoked or scope changed) |
| 422 | Returned as adapter error result with provider message | Surfaces the error to caller (validation fail) |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details through dispatcher error handling |

## Device Flow note

GitHub Device Flow omits `client_secret` but has awkward UX (the user has to enter a code on `github.com/login/device`). Bluetab does NOT use Device Flow — the Supertry bridge is the chosen path. If the bridge implementation slips on the Supertry side, Device Flow is the documented fallback. RESEARCH §Pitfall 5 captures the rationale.

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- The adapter never calls the Supertry bridge. The bridge is auth-time only.
- Group and Brain Dump reads route through existing service helpers.
- `pullFromIntegration` remains UI-only and is not registered as an AI verb.
