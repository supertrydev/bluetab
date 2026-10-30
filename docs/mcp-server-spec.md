# Bluetab MCP Server — Implementation Specification

**Status:** Draft v2 (Phase 13 hand-off deliverable from Bluetab to Supertry backend team)
**Date:** 2026-04-26
**Revision:** v2 — addresses Supertry team review feedback (6 clarifications + 4 resolved open questions)
**Owner — Bluetab side:** Phase 13 planning (`.planning/phases/13-mcp-bidirectional/`)
**Owner — Supertry side:** Backend team (this document is the contract)

This is the authoritative implementation specification for the Supertry-hosted Bluetab MCP server. The Bluetab browser extension produces a non-archival snapshot, pushes it to Supertry on a debounced schedule, and accepts external MCP clients (Claude Desktop, Cursor, etc.) authorized through Supertry. OAuth 2.1 + PKCE is the primary client path; a server-backed personal-token fallback exists for header-only hosts. Writes invoked by external clients while the extension is offline queue at Supertry with a 7-day TTL and replay through SSE on next online. This document specifies every public-facing contract Supertry must implement; Bluetab consumes them via the schemas in `src/types/mcp.ts`.

The locked tool surface is 13 tools (6 reads + 7 writes), zero of which are flagged `destructive: true` in v3.0. The confirmation-token machinery (Section 8) is specified anyway so v3.1 can ship a destructive tool with a one-line registry change.

---

## 1. Protocol Version

Bluetab pins to the **MCP 2025-03-26 Streamable HTTP** baseline for the transport. Supertry MUST advertise `2025-03-26` as the supported protocol version on every MCP endpoint response and accept the `MCP-Protocol-Version` request header from Bluetab and external clients.

Supertry does **not** upgrade the transport in this phase. Some higher-level capabilities from newer MCP drafts are intentionally forward-ported behind the same `2025-03-26` transport pin, most notably the prompt catalog (`prompts/list`, `prompts/get`). That does not change the advertised transport version.

JSON-RPC batching is accepted for compatibility on `POST /api/mcp`:

- `initialize` inside a batch MUST be rejected with `-32600`
- notification-only or response-only batches MUST return HTTP `202`
- request batches MUST return a JSON-RPC response array

`GET /api/mcp` is reserved for auth discovery only. Unauthenticated requests return `401` with `WWW-Authenticate`; authenticated requests return `405 stream_not_supported`. Supertry does not expose a custom public SSE stream on `/api/mcp`.

---

## 2. Tool Registry

The locked tool surface for v3.0 is exactly 13 tools defined in `src/types/mcp.ts` as the `MCP_TOOL_REGISTRY` Zod registry. Supertry's `tools/list` response MUST mirror this registry verbatim — adding, removing, or renaming a tool requires a coordinated PR on both sides.

| Name | Toolset | Write Level | Destructive | Args (Zod schema reference) |
|---|---|---|---|---|
| `list_groups` | groups | read | false | `z.object({})` |
| `get_group` | groups | read | false | `{ id: string }` |
| `search_tabs` | groups | read | false | `{ query: string (>=1 char) }` |
| `list_projects` | groups | read | false | `z.object({})` |
| `list_brain_dump` | brain_dump | read | false | `z.object({})` |
| `get_brain_dump_entry` | brain_dump | read | false | `{ id: string }` |
| `save_tab_group` | groups | write | false | `{ name, tabs:[{title,url,notes?}], notes? }` |
| `update_group` | groups | write | false | `{ id, name?, notes?, addTabs?, removeTabIds? }` |
| `add_project` | groups | write | false | `{ name, groupIds? }` |
| `update_project` | groups | write | false | `{ id, name?, groupIds? }` |
| `add_brain_dump` | brain_dump | write | false | `{ text (1..10000), context?:{title?,url?} }` |
| `update_brain_dump` | brain_dump | write | false | `{ id, text (1..10000) }` |
| `create_reminder` | reminders | write | false | `{ title, fireAt:int>0, groupId? }` |

**Toolset categories (3, locked):** `groups`, `brain_dump`, `reminders`. MCP-11 enforces per-client toggles at this granularity — Supertry filters `tools/list` responses based on the per-client toolset enable matrix.

**Drift detection:** the Bluetab CI test `src/services/__tests__/mcp-spec-contract.test.ts` asserts this document contains every required section heading. Supertry SHOULD run a parallel CI step that diffs its `tools/list` response shape against `MCP_TOOL_REGISTRY` exported from `src/types/mcp.ts`.

**Not exposed in v3.0:** flow rules, focus state, pomodoro/flowtime state, stats, RSS, ADHD settings, offline reading library, Teams sessions, reminder reads/updates, archive operations, any delete/remove/clear. Adding any of these requires a snapshot schema version bump (Section 9) and coordinated PRs on both Bluetab + Supertry.

---

## 3. Authentication — OAuth 2.1 + PKCE

External MCP clients authenticate to the Supertry MCP server in one of two supported modes:

1. **OAuth 2.1 + PKCE** for hosts that can complete the authorize flow
2. **Personal MCP token** for header-only hosts that cannot complete OAuth

Bluetab the extension does NOT act as an external OAuth client. It only manages consent, snapshot push, connected-client state, and personal-token creation through session-authenticated Supertry endpoints.

**Endpoints:**

| Endpoint | Purpose |
|---|---|
| `POST /oauth/register` | Dynamic client registration; stores redirect URIs and client metadata |
| `GET /oauth/authorize` | Authorization page; the user logs into Supertry and approves the external client |
| `POST /oauth/token` | Token exchange after authorization code grant; PKCE `code_verifier` validated against `code_challenge` |
| `POST /oauth/token` (refresh) | Refresh-token grant for expired access tokens |
| `POST /oauth/revoke` | OAuth token revocation; revokes only the presented refresh token |
| `GET /api/mcp/clients` | Session-authenticated Bluetab settings roster |
| `DELETE /api/mcp/clients?client_id=...` | Session-authenticated full client revoke for the current user |
| `POST /api/mcp/personal-tokens` | Session-authenticated personal MCP token create / replace |
| `DELETE /api/mcp/personal-tokens/:clientId` | Session-authenticated personal-token revoke |

**PKCE:** `code_challenge_method=S256` is REQUIRED. The 43-128 char `code_verifier` is generated by the external client, the SHA256 base64url-encoded `code_challenge` is sent on the authorization request, and Supertry validates the verifier on token exchange.

**JWT claims (issued access token):**
```json
{
  "iss": "supertry",
  "sub": "<user-id>",
  "aud": "bluetab-mcp",
  "exp": 1740003600,
  "scope": "mcp:read mcp:write",
  "resource": "https://supertry.net/api/mcp",
  "client_id": "<external-client-id>",
  "client_name": "Claude Desktop — macOS"
}
```

**Token lifetimes:**
- OAuth access token: 1 hour
- OAuth refresh token: 30 days
- Personal MCP token: server-defined expiry, stored hashed at rest

**Resource Indicators (RFC 8707):** the `resource` parameter on the authorization request and the `resource` claim on the issued JWT MUST be set to the MCP server URL. Even though 2025-03-26 does not mandate Resource Indicators, Supertry implements them now for forward compatibility with 2025-06-18 and to harden Section 4 audience segregation.

---

## 4. Audience Segregation (MCP-13)

Supertry runs three logically segregated service scopes — sync, Bluet bridge, MCP — each with a distinct JWT `aud` claim value. Each scope MUST validate `aud` on every incoming request and reject tokens whose audience does not match. This is the MCP-13 invariant: a token issued for one scope cannot be used to access another scope's data.

**Deployment topology is Supertry's operational call.** A single deployment with middleware-level `aud` validation per route prefix is acceptable for v3.0. Separate deployments (distinct subdomains/containers) may follow post-GA if scaling requires it. The security property — aud-based access control — is identical regardless of deployment model.

**Audience matrix:**

| Audience value | Route prefix (single deploy) | Scopes |
|---|---|---|
| `bluetab-sync` | `/api/sync/*` | `sync_deltas`, `snapshot_read_write` |
| `bluetab-bridge` | `/api/bridge/*` | `bluet_bridge_read`, `bluet_bridge_write` |
| `bluetab-mcp` | `/api/mcp/*` | `mcp:read`, `mcp:write` |

**Authorization endpoint contract:** the OAuth 2.1 authorization endpoint MUST inspect the requested MCP scopes and `resource` parameter and issue a token with `aud` set accordingly. A request targeting `resource=https://supertry.net/api/mcp` with MCP scopes (for example `mcp:read mcp:write`) cannot return a token whose `aud=bluetab-sync` even if the user is authenticated.

**Recommended implementation:** middleware validates `aud` claim against the route prefix on every request. Better Auth's existing session/bearer-token infrastructure can be extended with the OAuth 2.1 provider plugin for PKCE + refresh + revocation; custom `aud` claim injection via a token-issue hook.

**Acceptance tests for Supertry CI (Bluetab cannot verify these from outside; Supertry MUST run them):**

1. Issue a token with `aud=bluetab-sync`. Send it to `https://supertry.net/api/mcp`. MUST return `401 Unauthorized` (or `403 Forbidden`) with body referencing audience mismatch.
2. Issue a token with `aud=bluetab-mcp`. Send it to `sync.supertry.net/v1/deltas`. MUST return `401`/`403`.
3. Issue any external MCP bearer token (`aud=bluetab-mcp` or `aud=bluetab-bridge`). Send it to `https://supertry.net/api/mcp/snapshot`. MUST return `401`/`403` because snapshot upload is session-authenticated and does not accept external MCP client credentials.
4. Refresh tokens MUST inherit the original audience — refreshing an `aud=bluetab-mcp` refresh token cannot yield an access token with `aud=bluetab-sync`.

**Why this matters:** A compromised external MCP client (e.g., a malicious Claude Desktop extension) that steals a Bluetab MCP bearer token CANNOT use that token to read sync deltas, even though both services live behind `*.supertry.net` and share the same Supertry user identity. Audience segregation is the cryptographic boundary.

---

## 5. Rate Limits

Supertry's MCP server MUST enforce per-tool rate limits:

| Tool | Per-client per-minute cap | Per-user per-day cap |
|---|---|---|
| `list_groups`, `list_projects`, `list_brain_dump` | 60 | 5,000 |
| `get_group`, `get_brain_dump_entry`, `search_tabs` | 120 | 10,000 |
| `save_tab_group`, `update_group`, `add_project`, `update_project` | 30 | 1,000 |
| `add_brain_dump`, `update_brain_dump` | 30 | 1,000 |
| `create_reminder` | 10 | 200 |

**Snapshot push (Bluetab session-auth to Supertry):** capped at the existing sync delta-flush cadence (500 ms debounce per Bluetab device). No per-tool limit applies; the limit is the natural debounce.

**Rate-limit response:** HTTP `429 Too Many Requests` with `Retry-After` header (seconds) and JSON body `{ "error": { "code": "rate_limit_exceeded", "tool": "<tool>", "retry_after_s": <int> } }`. External clients are expected to honor `Retry-After` exponentially.

---

## 6. Error Codes + Retry Semantics

Supertry's MCP server MUST follow the standard MCP error model (JSON-RPC 2.0 error object). Codes specific to Bluetab MCP are in the `-32099..-32000` reserved range.

| Code | Reason | Retryable? |
|---|---|---|
| `-32700` | Parse error (malformed JSON-RPC) | No |
| `-32600` | Invalid request | No |
| `-32601` | Method not found (tool name not in registry) | No |
| `-32602` | Invalid params (Zod validation failed) | No |
| `-32603` | Internal error | Yes (with backoff) |
| `-32000` | Audience mismatch (`aud` claim wrong) | No (re-authenticate) |
| `-32001` | Toolset disabled for this client (MCP-11) | No (user must re-enable) |
| `-32002` | _(removed in v2 — replaced by `stale` response field, see Section 9)_ | — |
| `-32003` | Service unavailable (kill switch active — see Section 10) | Yes (with long backoff) |
| `-32004` | Rate limit exceeded (mirrors HTTP 429) | Yes (honor `Retry-After`) |
| `-32005` | Pending confirmation required (Section 8) | Yes (with confirmation token) |
| `-32006` | Pending confirmation expired or invalid token | No |

**Retry semantics:** retryable errors honor exponential backoff (initial 1s, max 60s, max 5 retries). Non-retryable errors surface to the external client which renders the error in its own UI.

---

## 7. Async Write Queue Protocol (MCP-07)

When Bluetab is offline, external client writes invoked against the MCP server queue at Supertry with a 7-day TTL. On Bluetab's next online connection, Supertry replays the queued writes through the existing SSE channel.

**Queue entry shape:**
```json
{
  "invocation_id": "<uuid>",
  "client_id": "<external-client-id>",
  "tool_name": "add_brain_dump",
  "args": { "text": "remember the milk" },
  "queued_at": 1740000000000,
  "expires_at": 1740604800000
}
```

**TTL:** 7 days from `queued_at`. After expiry the queue entry is dropped and the external client is NOT notified — the original tool call already returned `{ status: "queued", invocation_id }` to the client.

**Replay channel:** the existing `sync.supertry.net` SSE channel (`src/services/sync-realtime.ts:onEvent`). A new `event.type: "mcp-replay"` discriminator carries the queue entry. Bluetab routes the event to `MCPServerService.replayWrite()` which (a) parses args through the locked Zod registry (Section 2), (b) dispatches to the named service (`BrainDumpService.add` etc. — XC-01 contract), (c) writes an `mcp_invocations` log entry with `outcome: "replayed"` and `source_client_id: client_id` BEFORE returning, (d) stamps the resulting record with `createdBy: client_id` for future activity-log surfacing.

**Conflict resolution — LWW for updates only, creates always execute:**

- **Create operations** (`save_tab_group`, `add_project`, `add_brain_dump`, `create_reminder`): generate new records with unique IDs. No conflict is possible — queued creates ALWAYS execute on replay regardless of timing.
- **Update operations** (`update_group`, `update_project`, `update_brain_dump`): target an existing record by ID. If the live record's `modified` timestamp is NEWER than the queued event's `queued_at`, the replay is dropped (Last-Writer-Wins). The invocation log records `outcome: "replayed"` with `error_message: "lww-skipped: live record newer"`.
- **Edge case:** if a create's target ID already exists on the live tree (rare race), treat as an update and apply LWW.

**Silent replay (v3.0):** no toast, no notification. The invocation log entry is the only surfacing. The future Bluetab-wide activity log will read these.

---

## 8. Confirmation Token Protocol (SAFETY-04)

The confirmation-token round-trip protects destructive tools from being invoked without explicit user approval. In v3.0 NO tool is flagged `destructive: true`, so this protocol is specified but never triggered. The contract test in `src/services/__tests__/mcp-safety-04.contract.test.ts` is vacuously green today and flips live the day a destructive tool ships.

**Two-step protocol:**

**Step 1.** External client invokes a destructive tool (e.g. hypothetical `delete_group`). Server returns:
```json
{
  "status": "pending_confirmation",
  "token": "<32-byte random base64url>",
  "description": "Delete group 'Shopping' with 12 tabs. This cannot be undone.",
  "expires_at": 1740000000000
}
```

**Step 2.** External client renders the confirmation prompt natively (Claude Desktop / Cursor have their own confirmation UI). On user approval, the client invokes the `confirm_action` **JSON-RPC method** (NOT a tool — it does not appear in `tools/list`):
```json
{
  "jsonrpc": "2.0",
  "method": "confirm_action",
  "params": { "token": "<token-from-step-1>" },
  "id": 42
}
```

`confirm_action` is a protocol-level method alongside `initialize`, `tools/list`, and `tools/call` — not a tool in the 13-tool registry. Server validates the token has not expired (5-minute TTL) and re-dispatches the original destructive tool with the original args.

**External-client-renders-UI contract:** Bluetab does NOT render a Bluetab-side `pendingConfirmation` UI in the sidepanel. The approval happens in the user's external agent UI. This is per CONTEXT.md §Confirmation surface.

**v3.0 vacuous behavior:** Supertry's MCP server iterates `MCP_TOOL_REGISTRY` and flags tools with `destructive: true`. With zero such tools today, the protocol code path is unreachable. When a destructive tool lands in v3.1+, the registry flip activates Step 1 automatically.

---

## 9. Snapshot Push Endpoint

Bluetab pushes the locked snapshot payload (`MCPSnapshotSchema` from `src/types/mcp.ts`) to Supertry on every sync-engine delta flush (500 ms debounce piggyback). Supertry serves this snapshot to external MCP clients invoking read tools.

**Endpoint:** `POST https://supertry.net/api/mcp/snapshot`

**Request headers:**
- `Authorization: Bearer <Supertry session token>`
- `Content-Type: application/json`
- `Content-Encoding: gzip`
- `MCP-Protocol-Version: 2025-03-26`

**Request body:** gzip-compressed JSON matching `MCPSnapshotSchema`:
```typescript
{
  version: 1,                       // literal — bump triggers Supertry-side migration
  generated_at: number,             // epoch ms
  device_id: string,                // existing Bluetab sync device ID
  groups: Array<{ id, name, notes?, tabs: [{id, title, url, notes?}], created, modified }>,
  projects: Array<{ id, name, groupIds: string[] }>,
  brain_dump: Array<{ id, text, timestamp, context?: { title?, url? } }>,
  client_toolsets?: Record<string, { groups: boolean, brain_dump: boolean, reminders: boolean }>
}
```

**`client_toolsets` (optional, v3.0):** per-client toolset enable/disable matrix. Key = `client_id`, value = toolset toggle map. Bluetab pushes this alongside the data snapshot whenever the user changes toggles in Settings → MCP → Connected Clients. Supertry reads `client_toolsets` and filters `tools/list` responses accordingly. No separate config endpoint needed — the matrix travels with the existing 500ms debounce push.

**Compression:** Bluetab uses the native `CompressionStream('gzip')` API in the offscreen document to compress before POST. Supertry MUST decompress on receive; expected ratio 5-10× (worst-case 1.5 MB JSON → 150-300 KB compressed).

**Auth boundary:** this snapshot endpoint is not part of the external OAuth / personal-token MCP client surface. It is a session-authenticated extension-to-Supertry upload path.

**Response:**
- `200 OK` with `{ "stored": true, "snapshot_id": "<id>" }`
- `400 Bad Request` if Zod validation fails on Supertry side (defense in depth — Bluetab also validates)
- `413 Payload Too Large` if compressed body exceeds 1 MB (Bluetab logs and falls back to delta-push in v3.1+)

**Server-side URL redaction (defense in depth):** Bluetab strips sensitive query params (`token`, `session`, `key`, `password`, `auth`, `code` and common variants — see `src/utils/url-redaction.ts`) BEFORE the snapshot leaves the device. Supertry MUST run **equivalent** redaction on receive as a backstop. Bluetab provides `docs/url-redaction-test-vectors.json` with input/expected-output pairs; Supertry reimplements in its own runtime and validates against the same test vectors. Implementations may diverge in internals as long as test vectors pass.

**Snapshot read tools served from this snapshot:** `list_groups`, `get_group`, `search_tabs`, `list_projects`, `list_brain_dump`, `get_brain_dump_entry` (Section 2).

**Staleness handling (v2 — replaces `-32002` hard error):** Supertry MUST include `stale: boolean` and `generated_at` (epoch ms) in every read-tool response. `stale: true` when `generated_at` is older than 5 minutes (e.g., user's laptop was closed). Supertry NEVER refuses a read due to staleness — it always serves the latest available snapshot with the `stale` flag. External clients (Claude Desktop, Cursor) decide whether to surface a caveat like "Note: this data is from 2 hours ago."

**Schema extensibility:** `version: 1` is the v3.0 baseline. Adding a record type (flow rules, focus state, etc.) in v3.1+ requires bumping `version: 2` and a coordinated PR on both Bluetab + Supertry. The `MCPSnapshotSchema` Zod schema uses `.strict()` so accidental top-level additions fail Bluetab CI before they ship.

---

## 10. Kill Switch

PRIVACY-03 reuses the Phase 11 `kill-switch-service` pattern for the MCP server. Supertry's config-fetch endpoint (`GET https://config.supertry.net/v1/config`) returns a flag the extension polls.

**Config fetch response shape (relevant slice):**
```json
{
  "mcp_server_disabled": false,
  "mcp_server_disabled_reason": null
}
```

When `mcp_server_disabled: true`:
- Bluetab stops pushing snapshots — `MCPServerService.pushSnapshotIfEnabled()` returns immediately when the flag is true.
- Supertry's MCP server returns `-32003 service_unavailable` to all external client requests.
- The `mcp_server_disabled_reason` (optional human-readable string) MAY be surfaced to external clients in the error body's `data` field for transparency.

**Server-side only:** the kill switch is a server-side concern. User-added MCP CLIENT endpoints (the external servers a user adds to Bluetab's AI chat — MCP-14) keep working when `mcp_server_disabled: true`, because those are user-chosen and not Bluetab-controlled.

**Polling cadence:** inherits the existing `kill-switch-service` 1-hour poll interval. No new alarm.

---

## 11. HTTPS and Private-IP Requirements

This section is **reference-only** for Bluetab's CLIENT side (MCP-18) — Supertry does not implement these checks because Supertry only operates its own HTTPS endpoints. Documented here for completeness so Supertry's team understands Bluetab's threat model when reviewing the spec.

**Bluetab client-side enforcement (`src/utils/ssrf-defense.ts`, Plan 13-02):**
- Reject any user-added MCP endpoint URL whose protocol is not `https:`.
- Reject IPv4 private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
- Reject IPv4 loopback: `127.0.0.0/8`.
- Reject IPv4 link-local: `169.254.0.0/16` (covers AWS metadata `169.254.169.254`).
- Reject IPv6 loopback: `::1`.
- Reject IPv6 link-local: `fe80::/10`.
- Reject IPv6 ULA: `fc00::/7`.
- Reject `localhost` literal.
- `fetch` calls use `redirect: 'error'` to refuse all redirects (MCP endpoints should not redirect; redirect-to-private-IP is the SSRF attack vector).

**Supertry's responsibility (separate):** ensure `https://supertry.net/api/mcp` is HTTPS-only with HSTS and a valid certificate. Supertry MUST NOT serve the MCP API over plain HTTP under any circumstances.

---

## Appendix A: Storage Keys (Bluetab side, non-syncable per MCP-19)

For Supertry team awareness — these are Bluetab-side `chrome.storage.local` keys related to MCP. None of them are in Bluetab's `SYNCABLE_KEYS`:

- `mcp_client_endpoints` — array of user-added external MCP endpoints (id, url, optional authHeader)
- `mcp_server_settings` — server enable flag + per-client toolset matrix
- `mcp_invocations` — ring-buffered invocation log (cap 1000, 30-day TTL)
- `mcp_server_consent_given_at` — PRIVACY-05 consent timestamp
- `mcp_client_trust_acknowledged` — MCP-14 first-add trust modal flag
- `mcp_endpoint_capabilities:<server_id>` — per-endpoint `tools/list` cache

The MCP-19 contract test (`src/services/__tests__/mcp-19-sync-isolation.contract.test.ts`) asserts none of these are syncable.

---

## Appendix B: Resolved Questions (v2)

Resolved during Supertry team review (2026-04-26):

1. **Audience segregation:** Logical middleware-level `aud` validation per route prefix ships with v3.0. Single deployment acceptable — no separate subdomains required. Section 4 updated to reflect.
2. **SSE channel multiplexing:** Reuse the existing sync SSE channel with Redis pub/sub for `mcp-replay` events. No dedicated public `/api/mcp` SSE endpoint is needed for v3.0. Low-risk addition per Supertry team assessment.
3. **Snapshot payload limit:** 1 MB compressed within Vercel limits. Next.js `bodyParser.sizeLimit` default = 1 MB, Vercel platform = 4.5 MB. No config changes needed.
4. **Kill-switch propagation:** 1-hour client-side poll is belt-and-suspenders. Supertry returns `-32003` server-side immediately on incident (fast path). Client poll catches up within the hour. Dual-path accepted.
5. **OAuth 2.1 implementation:** Extend Better Auth with OAuth 2.1 provider plugin (PKCE + refresh + revocation). Custom `aud` claim injection via token-issue hook. No standalone OAuth server needed.
6. **confirm_action protocol:** Clarified as JSON-RPC method, not a tool in the 13-tool registry. Section 8 updated.
7. **LWW scope:** Clarified — creates always execute, LWW applies only to updates targeting the same record ID. Section 7 updated.
8. **Staleness handling:** `-32002` hard error removed. Replaced with `stale: boolean` + `generated_at` response field — external clients decide whether to surface a caveat. Section 9 updated.
9. **URL redaction parity:** "Same redaction" softened to "equivalent redaction validated against shared test vectors." Bluetab provides `docs/url-redaction-test-vectors.json`. Section 9 updated.
10. **Per-client toolset storage:** `client_toolsets` travels as an optional field in the snapshot payload — no separate config endpoint. Section 9 updated.

---

*End of specification.*
