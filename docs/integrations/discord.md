# Discord Integration

## Purpose

The Discord integration lets Bluetab share tab groups, individual messages, and Brain Dump entries into a Discord channel of the user's choosing. It is a Tier 2 pure-PKCE integration on the standard `chromiumapp.org` redirect. The integration uses Discord's **webhook flow** — the user picks a channel during OAuth consent and Bluetab receives a webhook URL it can post to without an Authorization header.

## Runbook: PUBLIC_OAUTH2_CLIENT — one-time configuration

Before Bluetab's Discord OAuth flow can succeed, the Discord application at <https://discord.com/developers/applications/{app_id}> must have the **`PUBLIC_OAUTH2_CLIENT`** flag enabled (RESEARCH §Pitfall 7).

- This flag is set at the Discord application-registration side, **not** in any Bluetab source code.
- The flag is required for the public PKCE flow (no `client_secret`) to pass Discord's token-exchange check at `https://discord.com/api/oauth2/token`.
- Without the flag, the token exchange returns `invalid_client` and connect fails.
- Discord allows toggling this flag from the developer console — it is not as irreversible as Slack's equivalent, but treat it as a one-time setup step performed by an administrator of the Discord application.

## OAuth setup

- **Authorize URL:** `https://discord.com/oauth2/authorize`
- **Token URL:** `https://discord.com/api/oauth2/token`
- **Scopes:** `webhook.incoming`
- **Redirect URI:** `https://<extension-id>.chromiumapp.org/` (returned by `chrome.identity.getRedirectURL()`)
- **Client type:** Public PKCE client. No `client_secret` in the extension.

## Webhook model — channel chosen during consent

The `webhook.incoming` scope is a special Discord OAuth scope: rather than handing back a generic API access token, Discord prompts the user to pick a guild and channel during consent and **returns a webhook object in the token response**. The webhook object includes a `url` that looks like:

```
https://discord.com/api/webhooks/{webhook_id}/{webhook_token}
```

The path's `{webhook_id}` and `{webhook_token}` segments together act as the auth credential — anyone with that URL can post to the chosen channel. Bluetab:

- Captures the `webhook_url` at OAuth time and stores it in `accountMeta.webhook_url` (encrypted alongside the token bundle in `integration-token-storage.ts` per Plan 14-01 / TOKEN-01).
- Has the adapter POST directly to that URL with **no `Authorization` header** — the webhook URL is its own auth.
- Treats webhook revocation as a 401: the user removed the webhook in Discord's "Server Settings → Integrations" UI. The adapter throws the provider `Response` and the dispatcher flags the reauth banner.

This is by design: it constrains Bluetab to a single channel chosen at connect time, instead of granting it broad write access to the user's Discord account.

## Token model

- Webhook tokens are **non-expiring** for as long as the webhook exists. The registry sets `token_expiry_seconds: null` and `supports_refresh: false`.
- A 401 from the webhook URL means the user deleted the webhook on Discord's side. The adapter throws the provider `Response`; the dispatcher routes that into the reauth banner. The user re-runs Connect to pick a new channel and capture a fresh webhook URL.

## Rate limits

- Discord webhook rate limit: **5 requests per channel per 2 seconds** (= 2.5 rps). The registry uses `rate_limit_rps: 2` (rounded down) to stay safely under the budget.
- Discord also has a global per-application limit of **50 req/s**, well above the per-channel limit Bluetab uses.
- The adapter throws the provider `Response` on 429 so the dispatcher can read `Retry-After` and back off.

## Verb endpoint shapes

### `share_to_channel`

- **Endpoint:** `POST <accountMeta.webhook_url>` (NOT a fixed Discord API URL — important)
- **Headers:** `Content-Type: application/json`. **No `Authorization` header.**
- **Body:** `{ content?: <message>, embeds?: [...] }`
- **Result:** `{ delivered: true }` (Discord returns `204 No Content` for webhook success — the marker exists so the dispatcher and UI have something to render).

### `send_group_to_discord`

- Reads the remembered Bluetab group via `GroupMemoryStorageService` (XC-01).
- Builds a single Discord embed with:
  - `title`: the group name (truncated to 256 chars, the Discord embed title limit)
  - `description`: one Markdown link per tab — `[<title>](<url>)` joined with newlines (truncated to 4096 chars, the Discord embed description limit)
  - `color`: `0x3b82f6` (Bluetab blue)
- POSTs to `accountMeta.webhook_url`.

### `push_brain_dump_to_discord`

- Reads a Brain Dump entry via `BrainDumpService.list()` (XC-01).
- Builds a single embed with:
  - `title`: `'Brain dump'`
  - `description`: the entry text (truncated to 4096 chars)
  - `color`: `0x3b82f6`
- POSTs to `accountMeta.webhook_url`.

## Embed limits

| Field | Limit |
|-------|-------|
| `embed.title` | 256 chars |
| `embed.description` | 4096 chars |
| Total embed payload | 6000 chars across all fields |
| Embeds per message | 10 |

The adapter truncates `title` and `description` to their per-field limits — long content is silently shortened rather than rejected by Discord. Users who need the full content should use the destination integration that fits the payload size (Notion, Linear, etc.).

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 / 204 | Returns `{ success: true, result: { delivered: true } }` | Updates account last-used timestamp |
| 401 | Throws provider `Response` (webhook deleted) | Sets reauth banner state centrally |
| 404 | Throws provider `Response` | Surfaces error to caller |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details through dispatcher error handling |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- Group reads route through `GroupMemoryStorageService.getMemory`. Brain Dump reads route through `BrainDumpService.list`. No direct storage access.
- `webhook_url` is captured at OAuth time and stored in the encrypted token bundle alongside the access token. It is NEVER logged or synced (TOKEN-01).
