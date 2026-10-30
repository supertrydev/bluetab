# Slack Integration

## Purpose

The Slack integration lets Bluetab post messages to Slack channels, send direct messages, share a tab group as a bulleted list of links, and push Brain Dump entries into a channel. It is a Tier 2 pure-PKCE integration on the standard `chromiumapp.org` redirect.

## Runbook: PUBLIC_OAUTH2_CLIENT — one-time, IRREVERSIBLE

Before Bluetab's Slack OAuth flow can succeed, the Slack app at <https://api.slack.com/apps/{app_id}/general> must have the **`PUBLIC_OAUTH2_CLIENT`** flag enabled (RESEARCH §Pitfall 6).

- This flag is set at the Slack app-registration side, **not** in any Bluetab source code.
- The flag is **IRREVERSIBLE without contacting Slack support**. Once enabled, it cannot be turned off through the developer console. Plan accordingly.
- The flag is required because Slack treats the public PKCE flow (no `client_secret`) as a non-default profile and gates it behind this opt-in.
- Without the flag, the token exchange at `https://slack.com/api/oauth.v2.access` returns an `invalid_client` error and connect fails.

The flag is a deliberate one-time configuration step on the Slack side and must be performed by an administrator of the Slack app.

## OAuth setup

- **Authorize URL:** `https://slack.com/oauth/v2_user/authorize` (user-token authorize URL — Slack distinguishes user vs bot OAuth flows)
- **Token URL:** `https://slack.com/api/oauth.v2.access`
- **Scopes:** `chat:write` (user-token scope)
- **Redirect URI:** `https://<extension-id>.chromiumapp.org/` (returned by `chrome.identity.getRedirectURL()`; Slack accepts this redirect once the app has `PUBLIC_OAUTH2_CLIENT` enabled)
- **Client type:** Public PKCE client. No `client_secret` in the extension.

## Scope rationale — user-token `chat:write`, NOT bot scope

Bluetab requests the **user-token** `chat:write` scope, not the bot-token equivalent. This is forced by Slack's policy:

- Desktop redirect URIs (including `chromiumapp.org`) cannot request bot scopes per RESEARCH §Pitfall 6.
- A user-token post appears in Slack as the user themselves posting — Bluetab does not impersonate a separate bot identity.
- The user can revoke the integration at any time via Slack's "Apps" settings; revocation invalidates the user token immediately.

## Token model

- Slack PKCE issues an **access_token** that rotates every ~12 hours and a **refresh_token** that expires every 30 days (RESEARCH §Pitfall 6).
- The refresh token rotation is handled by `integration-token-storage.ts` (Plan 14-01 foundation) — the adapter never reads or writes tokens directly.
- A 401 response means the access_token has expired, was revoked, or the refresh_token has aged out (30 days). The adapter throws the provider `Response` so the dispatcher can flag the reauth banner centrally.
- A failed refresh-cycle surfaces through the same reauth banner — the Plan 14-01 helper distinguishes "user revoked" from "refresh token expired" via the Slack error code, but both flow into the same UI.

## Rate limits

- `chat.postMessage` is tier-1 in Slack's rate-limit categories: **1 req/s per channel**.
- The adapter throws the provider `Response` on 429 so the dispatcher can read `Retry-After` and back off.
- Bluetab's registry uses `rate_limit_rps: 1` to align with Slack's tier-1 budget.

## Verb endpoint shapes

### `share_to_channel`

- **Endpoint:** `POST https://slack.com/api/chat.postMessage`
- **Headers:** `Authorization: Bearer ${user_token}`, `Content-Type: application/json; charset=utf-8`
- **Body:** `{ channel: <channel_id_or_name>, text: <message>, blocks?: [...] }`
- **Result:** `{ messageTs, channelId }` parsed from the Slack `{ ok: true, ts, channel }` response.
- **Error mapping:** Slack returns HTTP 200 with `{ ok: false, error: <string> }` on most logical failures (unknown channel, missing scope, etc.). The adapter surfaces these as `{ success: false, error }`. HTTP 401/429 throw the `Response` for the dispatcher.

### `send_dm`

- Same endpoint as `share_to_channel`. The adapter places the user's `user_id` in the `channel` field. Slack auto-resolves `user_id`-as-channel to the user's IM channel — no `conversations.open` round-trip is required.
- **Body:** `{ channel: <user_id>, text }`
- **Result:** Same shape as `share_to_channel`.

### `send_group_to_slack`

- Reads the remembered Bluetab group via `GroupMemoryStorageService` (XC-01 — never `chrome.storage.local` directly).
- Formats `text` as Slack mrkdwn:
  ```
  *<group name>*

  • <https://example.com/a|Article A>
  • <https://example.com/b|Article B>
  ```
- Calls `share_to_channel` internally.

### `push_brain_dump_to_slack`

- Reads a Brain Dump entry via `BrainDumpService.list()` (XC-01).
- `text` is the entry text. When the entry has a `tabContext.url`, the adapter appends a context line: `\n\n_From <{url}|{title}>_`. Linkless entries omit the context line entirely.
- Calls `share_to_channel` internally.

## Slack `ok:false` response handling

Slack does NOT use HTTP error codes for application-layer failures. A POST to `chat.postMessage` returns `200 OK` with a JSON body of `{ ok: false, error: "channel_not_found" }` (or similar) when the call fails for non-auth reasons. The adapter:

- Checks `data.ok === true` before treating the call as success.
- When `ok` is false, returns `{ success: false, error: data.error || 'slack_error' }`.
- HTTP 401 and 429 are still treated as transport-level failures and the provider `Response` is thrown — only application-layer Slack errors (channel not found, missing scope, etc.) take the `ok:false` path.

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 with `ok: true` | Returns normalized `{ success: true, result }` | Updates account last-used timestamp |
| 200 with `ok: false` | Returns `{ success: false, error }` | Surfaces error to caller |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details through dispatcher error handling |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- Group reads route through `GroupMemoryStorageService.getMemory`. Brain Dump reads route through `BrainDumpService.list`. No direct storage access.
- Tokens are managed centrally in `integration-token-storage.ts` (TOKEN-01) — never logged, never synced, never inlined into adapter code.
