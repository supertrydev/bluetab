# Todoist Integration

## Purpose

The Todoist integration lets Bluetab create tasks from direct AI verbs, saved group tabs, and Brain Dump entries. It is a Tier 1 pure-PKCE integration and supports manual pull for recently updated tasks.

## OAuth setup

- **Authorize URL:** `https://app.todoist.com/oauth/authorize`
- **Token URL:** `https://api.todoist.com/oauth/access_token`
- **Scopes:** `task:add` for task creation, or `data:read_write` when manual pull needs broader access
- **Redirect URI:** Chromium app redirect URI from `chrome.identity.getRedirectURL()`
- **Client type:** Public PKCE client with `token_endpoint_auth_method: none`

## Client registration steps

1. Register a Todoist OAuth application for Bluetab.
2. Add the Bluetab Chromium app redirect URI to the allowed redirect URI list.
3. Configure the public client ID in `src/services/integrations/registry.ts` when the app is available.
4. Do not ship a client secret in the extension. This integration uses PKCE only.

## Token model

Todoist access tokens are treated as valid for 1 hour. Todoist rotates the refresh token on each refresh; `integration-token-storage` must persist the newest refresh token immediately to keep the connection usable.

## Rate limits

Todoist standard endpoints allow 240 requests per minute. List endpoints are lower at 20 requests per minute, so manual pull should stay conservative. The adapter throws 429 provider responses so the dispatcher can honor `Retry-After`.

## Verb endpoint shapes

### `create_task`

- **Endpoint:** `POST https://api.todoist.com/api/v1/tasks`
- **Arguments:** `content`, optional `due_date`, optional `priority`, optional `project_id`, optional `labels`
- **Result:** `{ taskId, taskUrl }`

### `send_group_to_todoist`

- Reads a remembered Bluetab group through `GroupMemoryStorageService`.
- Creates one Todoist task per tab.
- Uses the tab title as task content and the tab URL as task description.

### `push_brain_dump_to_todoist`

- Reads a Brain Dump entry through `BrainDumpService.list()`.
- Creates one Todoist task with the entry text and optional tab context URL.

## Manual pull semantics

Manual pull calls `GET https://api.todoist.com/api/v1/tasks?since=<ISO>` when a `since` date is provided. The adapter returns normalized task records with `id`, `content`, `due`, `priority`, and `updatedAt` in epoch milliseconds.

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 with task data | Returns normalized result | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details through dispatcher error handling |

## Contract notes

- Adapter files never call `chrome.storage.local.set` or `Storage.set` directly.
- Group and Brain Dump reads route through existing service helpers.
- The adapter does not cache or manage refresh tokens; token rotation belongs to `integration-token-storage`.
- `pullFromIntegration` remains UI-only and is not registered as an AI verb.
