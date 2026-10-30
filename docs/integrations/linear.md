# Linear Integration

## Purpose

The Linear integration lets Bluetab create Linear issues from direct AI verbs, saved group tabs, and Brain Dump entries. It is a Tier 1 pure-PKCE integration and supports manual pull for recently updated issues.

## OAuth setup

- **Authorize URL:** `https://linear.app/oauth/authorize`
- **Token URL:** `https://api.linear.app/oauth/token`
- **Scopes:** `issues:create write`
- **Redirect URI:** Chromium app redirect URI from `chrome.identity.getRedirectURL()`
- **Client type:** Public PKCE client with no client secret in the extension

## Client registration steps

1. Register a Linear OAuth application in Linear workspace settings.
2. Add the Bluetab Chromium app redirect URI to the allowed redirect URI list.
3. Configure the public client ID in `src/services/integrations/registry.ts` when the app is available.
4. Keep the client secret out of the extension. This integration uses PKCE only.

## Token model

Linear access tokens are treated as valid for 24 hours. Refresh tokens are stored in the encrypted local token bundle and are refreshed through `integration-token-storage` before adapter calls.

## Rate limits

Bluetab uses a conservative `rate_limit_rps` in the registry. Linear supports a high hourly API budget; this integration treats 429 responses as provider backoff signals and throws the original `Response` so the dispatcher can read `Retry-After`.

## Verb endpoint shapes

### `create_issue`

- **Endpoint:** `POST https://api.linear.app/graphql`
- **Mutation:** `issueCreate(input: IssueCreateInput!)`
- **Arguments:** `title`, optional `description`, optional `teamId`, optional `priority`, optional `assigneeId`
- **Fallback metadata:** `teamId` can fall back to `accountMeta.team_id`
- **Result:** `{ issueId, issueUrl }`

### `update_issue`

- **Endpoint:** `POST https://api.linear.app/graphql`
- **Mutation:** `issueUpdate(id: String!, input: IssueUpdateInput!)`
- **Arguments:** `issueId`, optional `title`, optional `description`, optional `priority`, optional `stateId`
- **Result:** `{ updated }`

### `send_group_to_linear`

- Reads a remembered Bluetab group through `GroupMemoryStorageService`.
- Creates one Linear issue per tab.
- Uses the tab title as the issue title and the tab URL as the issue description.

### `push_brain_dump_to_linear`

- Reads a Brain Dump entry through `BrainDumpService.list()`.
- Creates one Linear issue with the entry text and optional tab context URL.

## Manual pull semantics

Manual pull calls Linear GraphQL `issues(filter: { updatedAt: { gt } })` when a `since` date is provided. The adapter returns normalized issue records with `id`, `title`, `description`, `state`, and `updatedAt` in epoch milliseconds.

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 with data | Returns normalized result | Updates account last-used timestamp |
| GraphQL errors | Returns an adapter error result | Surfaces the error to caller |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details through dispatcher error handling |

## Contract notes

- Adapter files never call `chrome.storage.local.set` or `Storage.set` directly.
- Group and Brain Dump reads route through existing service helpers.
- `pullFromIntegration` remains UI-only and is not registered as an AI verb.
