# Bluetab MCP Server — Client Connection Guide

Connect external MCP hosts to Bluetab so they can read your saved groups, projects, reminders, and brain dump context.

**Server URL:** `https://supertry.net/api/mcp`

## Prerequisites

1. A Bluetab Pro account
2. Bluetab Settings → **MCP**
3. Enable **Bluetab MCP server**

## Use OAuth When The Host Supports It

OAuth is the preferred path. The host discovers Bluetab's protected-resource metadata, opens the authorize flow, and receives MCP-scoped access tokens from Supertry.

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "bluetab": {
      "type": "http",
      "url": "https://supertry.net/api/mcp"
    }
  }
}
```

Then complete the host's **Sign in / Authorize** flow.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bluetab": {
      "type": "http",
      "url": "https://supertry.net/api/mcp"
    }
  }
}
```

## Use A Personal MCP Token For Header-Only Hosts

Some hosts cannot finish OAuth and instead require a static bearer token. In Bluetab Settings → **MCP**, use **Create personal MCP token**. The token is shown once and is stored hashed on the server.

### Codex

```bash
codex mcp add --type streamable-http --header "Authorization: Bearer YOUR_PERSONAL_MCP_TOKEN" bluetab https://supertry.net/api/mcp
```

### Claude Code

```bash
claude mcp add --transport http bluetab https://supertry.net/api/mcp --header "Authorization: Bearer YOUR_PERSONAL_MCP_TOKEN"
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "bluetab": {
      "url": "https://supertry.net/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_PERSONAL_MCP_TOKEN"
      }
    }
  }
}
```

### Gemini CLI

Add to `~/.config/gemini/settings.json`:

```json
{
  "mcpServers": {
    "bluetab": {
      "httpUrl": "https://supertry.net/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_PERSONAL_MCP_TOKEN"
      }
    }
  }
}
```

### amp

```bash
amp mcp add bluetab https://supertry.net/api/mcp --bearer-token YOUR_PERSONAL_MCP_TOKEN
```

## Available Tools

Bluetab exposes these 13 MCP tools:

- `list_groups`
- `get_group`
- `search_tabs`
- `list_projects`
- `list_brain_dump`
- `get_brain_dump_entry`
- `save_tab_group`
- `update_group`
- `add_project`
- `update_project`
- `add_brain_dump`
- `update_brain_dump`
- `create_reminder`

## Available Prompts

Bluetab also exposes these read-only MCP prompts:

- `search_saved_tabs`
- `review_saved_group`
- `summarize_brain_dump`
- `plan_from_saved_context`

## Troubleshooting

| Problem | Fix |
|---|---|
| `401 unauthorized` | Re-run the OAuth authorize flow, or create a fresh personal MCP token for header-only hosts |
| `403 invalid_origin` | The host is sending a browser `Origin` header that is not allowed by the server |
| No tools appear | Make sure the MCP server is enabled and at least one toolset is still enabled for that client |
| `405 stream_not_supported` on GET | Expected. Bluetab does not expose a custom public SSE stream on `/api/mcp` |

## Token Management

- **OAuth clients:** manage access by revoking the client in Bluetab Settings → MCP
- **Header-only clients:** use **Create personal MCP token** to create a new token, or **Replace token** on an existing personal-token client

## Developer Note

- MCP tab wiring: `src/settings/main.tsx`
- MCP UI implementation: `src/settings/components/MCPServerSection.tsx`
- Server prompt catalog: `supertry-web/lib/mcp/prompts.ts`
