/**
 * @module settings/components/mcp/mcp-connect
 *
 * WHY:  The MCP settings page shows per-app setup (one-click links and CLI
 *       commands) and an honest upload status. Keeping the string building
 *       here makes it testable without rendering React.
 *
 * WHAT: - buildCursorInstallLink / buildVsCodeInstallLink: one-click installs
 *       - cliCommands: add + sign-in commands for terminal clients
 *       - genericJsonConfig: config snippet for any other host
 *       - describeUploadFailure: maps mcp_server_status.lastError to copy keys
 *       - classifyAccountCheck: maps the /clients probe status to a result
 */

export type McpAppId = 'claude' | 'chatgpt' | 'cursor' | 'vscode' | 'claude-code' | 'codex' | 'gemini' | 'other';

export const MCP_APPS: Array<{ id: McpAppId; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini CLI' },
];

export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors';
export const CHATGPT_DIRECTORY_URL = 'https://chatgpt.com/plugins/plugin_asdk_app_6ac3febc35308191a59d5bace8706914';

const SERVER_NAME = 'bluetab';

function toBase64(value: string): string {
  // URLs and JSON here are ASCII, so btoa is safe.
  return btoa(value);
}

/** Cursor one-click install: cursor://anysphere.cursor-deeplink/mcp/install?name=..&config=<base64 JSON> */
export function buildCursorInstallLink(url: string): string {
  const config = toBase64(JSON.stringify({ url }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** VS Code one-click install: vscode:mcp/install?<URL-encoded JSON> */
export function buildVsCodeInstallLink(url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, type: 'http', url }))}`;
}

export interface CliCommands {
  add: string;
  signIn: string | null;
}

export function cliCommands(app: 'claude-code' | 'codex' | 'gemini', url: string): CliCommands {
  switch (app) {
    case 'claude-code':
      // Claude Code signs in from the /mcp menu inside a session.
      return { add: `claude mcp add --transport http ${SERVER_NAME} ${url}`, signIn: '/mcp' };
    case 'codex':
      return { add: `codex mcp add ${SERVER_NAME} --url ${url}`, signIn: `codex mcp login ${SERVER_NAME}` };
    case 'gemini':
      return { add: `gemini mcp add --transport http ${SERVER_NAME} ${url}`, signIn: `/mcp auth ${SERVER_NAME}` };
  }
}

export function genericJsonConfig(url: string): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: 'http', url } } }, null, 2);
}

/** Header-based setup for apps that cannot do OAuth (personal token). */
export function personalTokenSnippets(url: string, token: string): Array<{ title: string; code: string }> {
  const header = `Authorization: Bearer ${token}`;
  const jsonWithHeader = (urlKey: 'url' | 'httpUrl') =>
    JSON.stringify({ mcpServers: { [SERVER_NAME]: { [urlKey]: url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  return [
    { title: 'Claude Code', code: `claude mcp add --transport http ${SERVER_NAME} ${url} --header "${header}"` },
    {
      title: 'Codex',
      code: `export BLUETAB_MCP_TOKEN=${token}\ncodex mcp add ${SERVER_NAME} --url ${url} --bearer-token-env-var BLUETAB_MCP_TOKEN`,
    },
    { title: 'Cursor (~/.cursor/mcp.json)', code: jsonWithHeader('url') },
    { title: 'Gemini CLI (~/.gemini/settings.json)', code: jsonWithHeader('httpUrl') },
    { title: 'HTTP', code: `URL: ${url}\nTransport: Streamable HTTP\n${header}` },
  ];
}

export type UploadFailureKey =
  | 'settings.mcp.failNetwork'
  | 'settings.mcp.failSignIn'
  | 'settings.mcp.failPro'
  | 'settings.mcp.failTooLarge'
  | 'settings.mcp.failServer';

export function describeUploadFailure(lastError: string | undefined): UploadFailureKey {
  if (lastError === 'network') return 'settings.mcp.failNetwork';
  if (lastError === 'http_401') return 'settings.mcp.failSignIn';
  if (lastError === 'http_402' || lastError === 'http_403') return 'settings.mcp.failPro';
  if (lastError === 'http_413') return 'settings.mcp.failTooLarge';
  return 'settings.mcp.failServer';
}

export type AccountCheck = 'ok' | 'signIn' | 'pro' | 'unreachable';

export function classifyAccountCheck(status: number | null): AccountCheck {
  if (status === null) return 'unreachable';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'signIn';
  if (status === 402 || status === 403) return 'pro';
  return 'unreachable';
}

/** Read-only sibling of the MCP URL. */
export function readOnlyMcpUrl(url: string): string {
  return `${url.replace(/\/$/, '')}/readonly`;
}

/** Origin of the MCP URL, for the RFC 9728 discovery document. */
export function protectedResourceMetadataUrl(url: string): string {
  return `${new URL(url).origin}/.well-known/oauth-protected-resource`;
}
