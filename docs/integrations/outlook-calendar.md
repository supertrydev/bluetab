# Outlook Calendar Integration

## Purpose

The Outlook Calendar integration lets Bluetab create calendar events on the user's primary Microsoft 365 / Outlook.com calendar from direct AI verbs and turn an open tab into a scheduled event. It is a Tier 2 pure-PKCE integration on the Microsoft Entra (Azure AD) public client flow. There is no manual pull or auto-sync — the integration is write-only.

## OAuth setup

- **Authorize URL:** `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- **Token URL:** `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- **Scopes:** `Calendars.ReadWrite offline_access`
- **Redirect URI:** Chromium app redirect URI from `chrome.identity.getRedirectURL()` mapped through the `chromiumapp.org` shape (registry entry sets `redirect_uri_kind: 'chromiumapp'` — Microsoft does NOT use the Google identity special case)
- **Client type:** Public PKCE client. Microsoft Entra distinguishes confidential and public clients explicitly — registering the Bluetab app as a "Mobile and desktop applications" platform with a redirect URI allows pure PKCE without a `client_secret`.

## Redirect URI behavior

Microsoft's OAuth flow uses the standard `<ext-id>.chromiumapp.org` redirect — no Microsoft-side aliasing. The registry entry sets `redirect_uri_kind: 'chromiumapp'` so `integration-oauth-service.ts` formats the redirect with the chromiumapp pattern and passes it through to Microsoft's authorize endpoint.

## Scopes

Bluetab requests:

- `Calendars.ReadWrite` — minimum scope for creating events on the primary calendar (Microsoft Graph does not offer a tighter `events.owned` scope).
- `offline_access` — required to receive a refresh token. Without it, the access token expires after 1 hour with no recovery path short of full reauth.

## Token model

Microsoft access tokens expire after 1 hour. The refresh token is stored in the encrypted token bundle and refreshed through `integration-token-storage` before adapter calls. A 401 response means the user revoked Bluetab in `https://account.microsoft.com/privacy/app-access` or the admin removed the OAuth grant — the adapter throws the provider `Response` so the dispatcher can flag the reauth banner centrally.

## Rate limits

Microsoft Graph applies a rolling per-user limit of 10,000 requests per 10 minutes (~16.67 requests per second). Bluetab uses `rate_limit_rps: 16` in the registry — slightly under the per-user ceiling so a single user with sustained activity stays within budget. The adapter throws the provider `Response` on 429 so the dispatcher can read `Retry-After` and back off.

## Verb endpoint shapes

### `create_event`

- **Endpoint:** `POST https://graph.microsoft.com/v1.0/me/events`
- **Headers:** `Authorization: Bearer ${token}`, `Content-Type: application/json`
- **Body:** `{ subject, body: { contentType: 'HTML', content }, start: { dateTime, timeZone }, end: { dateTime, timeZone }, location?: { displayName } }`
- **Datetime format:** Microsoft Graph requires both `dateTime` (ISO 8601) **and** an explicit `timeZone` field. Unlike Google Calendar, an ISO `Z` suffix alone is not enough — Graph rejects timezone-implicit payloads. The adapter always emits both fields.
- **Result:** `{ eventId, eventUrl }` where `eventUrl` is the response `webLink` (deep-link to the event in Outlook web).

### `schedule_tab_as_event`

- Wraps `create_event` for the common Bluetab flow of turning a tab into a scheduled event.
- Inputs: `tabTitle`, `tabUrl`, `when_iso`, optional `duration_minutes` (default 30), optional `tabNotes`.
- Derives `end_iso = new Date(when_iso).getTime() + duration_minutes * 60_000` rendered as ISO 8601.
- The event subject is `tabTitle`. The body is `tabUrl`, with `\n\n${tabNotes}` appended when notes are present. The body is sent as `contentType: 'HTML'` so URLs auto-link inside Outlook clients.

## Account metadata

The accountMeta object passed to `executeVerb` carries:

- `timezone` — IANA timezone string used for `start.timeZone` and `end.timeZone`. Falls back to `'UTC'` when missing.

## Payload notes — Microsoft Graph vs. Google Calendar

| Aspect | Microsoft Graph | Google Calendar |
|--------|-----------------|-----------------|
| Datetime field | `dateTime` (ISO 8601) | `dateTime` (ISO 8601) |
| Timezone | **Required** explicit `timeZone` field | Optional — `Z` suffix accepted, but Bluetab always sends explicit timeZone for symmetry |
| Body field | `body: { contentType, content }` | `description: string` |
| Location field | `location: { displayName }` | `location: string` |

The adapter emits Bluetab-shaped args that map cleanly to either backend.

## Error handling matrix

| Provider response | Adapter behavior | Dispatcher behavior |
|-------------------|------------------|---------------------|
| 200 / 201 with event payload | Returns normalized result | Updates account last-used timestamp |
| 401 | Throws provider `Response` | Sets reauth banner state centrally |
| 429 | Throws provider `Response` | Applies rate-limit backoff using `Retry-After` |
| 5xx | Throws provider `Response` | Returns provider status details through dispatcher error handling |

## Contract notes

- The adapter never calls `chrome.storage.local.set` or `Storage.set` directly (XC-01).
- The adapter does not implement `listRecords` — Outlook Calendar is write-only in Bluetab's verb taxonomy.
- The adapter never calls Microsoft Graph endpoints other than `/me/events` (least-privilege confinement).
