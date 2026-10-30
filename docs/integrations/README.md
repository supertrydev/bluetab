# Integrations Documentation Index

This directory contains documentation for Phase 14 curated third-party integrations.

## Files

| File | Description |
|------|-------------|
| [`SUPERTRY-BRIDGE-SPEC.md`](./SUPERTRY-BRIDGE-SPEC.md) | Token-exchange bridge endpoint contract for Supertry team. Covers Notion, GitHub, Jira, Asana. |

## Per-Integration Spec Tables

Detailed per-integration spec tables (auth type, endpoint URLs, PKCE requirements, scopes, token expiry, rate limits) are in:

`.planning/phases/14-curated-third-party-integrations/14-RESEARCH.md § Per-Integration Spec Tables`

## File Layout (Plans 14-02..14-06)

Each integration adapter is created in its own subdirectory:

```
src/services/integrations/
├── registry.ts           — INTEGRATION_REGISTRY (all 15 entries)
├── __placeholder/
│   └── adapter.ts        — no-op placeholder (Plan 14-01)
├── notion/
│   └── adapter.ts        — Notion adapter (Plan 14-03)
├── linear/
│   └── adapter.ts        — Linear adapter (Plan 14-02)
├── todoist/
│   └── adapter.ts        — Todoist adapter (Plan 14-02)
├── github/
│   └── adapter.ts        — GitHub adapter (Plan 14-03)
├── google-calendar/
│   └── adapter.ts        — Google Calendar adapter (Plan 14-04)
├── outlook-calendar/
│   └── adapter.ts        — Outlook Calendar adapter (Plan 14-04)
├── slack/
│   └── adapter.ts        — Slack adapter (Plan 14-05)
├── discord/
│   └── adapter.ts        — Discord adapter (Plan 14-05)
├── readwise/
│   └── adapter.ts        — Readwise (token-paste) adapter (Plan 14-06)
├── jira/
│   └── adapter.ts        — Jira adapter (Plan 14-06)
├── trello/
│   └── adapter.ts        — Trello (token-paste) adapter (Plan 14-06)
├── asana/
│   └── adapter.ts        — Asana adapter (Plan 14-06)
└── gitlab/
    └── adapter.ts        — GitLab adapter (Plan 14-06)
```

## Auth Distribution

- **Pure PKCE (8 integrations):** Linear, Todoist, Google Calendar, Outlook Calendar, Slack, Discord, GitLab — via `chrome.identity.launchWebAuthFlow` + PKCE, no `client_secret`.
- **Supertry bridge (4 integrations):** Notion, GitHub, Jira, Asana — PKCE flow with `code` forwarded to Supertry bridge for `client_secret`-based exchange.
- **Token paste (2 integrations):** Readwise (bearer token from account page), Trello (Trello `/1/authorize` redirect-to-token).

## Out of Scope

The following integrations are explicitly **NOT** supported in Phase 14 (by user decision, 2026-04-27):
- Spotify, Raindrop, Pocket, Perplexity (excluded pre-research)
- Obsidian (no official cloud API — Local REST API plugin only; unreliable for extension use)
- ChatGPT (direction is inverted — already covered by Phase 13 MCP server)
- Gmail (removed 2026-10: its restricted scope needs a yearly paid CASA security assessment)
- Google Keep (removed 2026-10: the Keep API only works for Google Workspace accounts)
