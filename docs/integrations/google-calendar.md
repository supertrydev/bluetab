# Google Calendar Integration

## Purpose

The Google Calendar integration lets Bluetab create calendar events from direct AI verbs and turn an open tab into a scheduled event. It is a Tier 2 pure-PKCE integration on the Google identity flow. There is no manual pull or auto-sync — the integration is write-only.

## OAuth setup

- **Authorize URL:** `https://accounts.google.com/o/oauth2/v2/auth`
- **Token URL:** `https://oauth2.googleapis.com/token`
- **Scopes:** `https://www.googleapis.com/auth/calendar.events.owned offline_access`
- **Redirect URI:** Google identity redirect from `chrome.identity.getRedirectURL()`
- **Client type:** Public PKCE client (Chrome extension installed-app type) with no `client_secret` in the extension. Google's installed-app OAuth profile permits PKCE-only token exchange for native and Chrome extension clients.

## Redirect URI behavior

Google integrations use `chrome.identity.getRedirectURL()` rather than `<ext-id>.chromiumapp.org`. Chrome's identity API maps this redirect to a Google-issued URL the OAuth app must authorize. The registry entry sets `redirect_uri_kind: 'google-identity'` so `integration-oauth-service.ts` picks the correct redirect at consent time.

## Scopes

Bluetab requests `calendar.events.owned` only — the narrowest write scope for events the user owns on their primary calendar. The integration does NOT request `calendar` (full read/write) or `calendar.events` (read/write across shared calendars). `offline_access` is requested so the token bundle includes a refresh token.

## Token model

Google access tokens expire after 1 hour. The refresh token is stored in the encrypted token bundle and refreshed through `integration-token-storage` before adapter calls. A 401 response means the user revoked Bluetab in their Google account settings or removed the OAuth grant — the adapter throws the provider `Response` so the dispatcher can flag the reauth banner centrally.

## Rate limits

The Google Calendar API allows roughly 1,000,000 requests per day per project with per-user budgets that vary by quota class. Bluetab uses a conservative `rate_limit_rps: 10` in the registry. The adapter throws the provider `Response` on 429 so the dispatcher can read `Retry-After` and back off.

## Verb endpoint shapes

### `create_event`

- **Endpoint:** `POST https://www.googleapis.com/calendar/v3/calendars/primary/events`
- **Headers:** `Authorization: Bearer ${token}`, `Content-Type: application/json`
- **Body:** `{ summary, description?, location?, start: { dateTime: ISO_string, timeZone }, end: { dateTime: ISO_string, timeZone } }`
- **Datetime format:** RFC 3339 timestamps. Google accepts a pure ISO `Z` suffix without a separate `timeZone` field, but Bluetab always sets `timeZone` for explicit symmetry with Outlook Calendar.
- **Result:** `{ eventId, eventUrl }` where `eventUrl` is the response `htmlLink` (deep-link to the event in Google Calendar).

### `schedule_tab_as_event`

- Wraps `create_event` for the common Bluetab flow of turning a tab into a scheduled event.
- Inputs: `tabTitle`, `tabUrl`, `when_iso`, optional `duration_minutes` (default 30), optional `tabNotes`.
- Derives `end_iso = new Date(when_iso).getTime() + duration_minutes * 60_000` rendered as ISO 8601.
- The event summary is `tabTitle`. The description is `tabUrl`, with `\n\n${tabNotes}` appended when notes are present.

## Account metadata

The accountMeta object passed to `executeVerb` carries:

- `timezone` — IANA timezone string used for `start.timeZone` and `end.timeZone`. Falls back to `'UTC'` when missing.

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 with event payload | Returns normalized result | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details through dispatcher error handling |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- The adapter does not implement `listRecords` — Google Calendar is write-only in Bluetab's verb taxonomy.
- The adapter is read-free aside from the verb arguments themselves; tab metadata flows in via the calling sidepanel context, not via direct storage access.
