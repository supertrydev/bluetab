import {
  buildCursorInstallLink,
  buildVsCodeInstallLink,
  classifyAccountCheck,
  cliCommands,
  describeUploadFailure,
  genericJsonConfig,
  personalTokenSnippets,
  protectedResourceMetadataUrl,
  readOnlyMcpUrl,
} from './mcp-connect';

const URL = 'https://supertry.net/api/mcp';

describe('mcp-connect helpers', () => {
  it('builds a Cursor install link with a base64 url config', () => {
    const link = buildCursorInstallLink(URL);
    expect(link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=bluetab&config=')).toBe(true);
    const config = decodeURIComponent(link.split('config=')[1]);
    expect(JSON.parse(atob(config))).toEqual({ url: URL });
  });

  it('builds a VS Code install link with an encoded http server', () => {
    const link = buildVsCodeInstallLink(URL);
    expect(link.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(link.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'bluetab',
      type: 'http',
      url: URL,
    });
  });

  it('gives add and sign-in commands for terminal apps', () => {
    expect(cliCommands('claude-code', URL).add).toBe(`claude mcp add --transport http bluetab ${URL}`);
    expect(cliCommands('codex', URL)).toEqual({
      add: `codex mcp add bluetab --url ${URL}`,
      signIn: 'codex mcp login bluetab',
    });
    expect(cliCommands('gemini', URL).add).toBe(`gemini mcp add --transport http bluetab ${URL}`);
  });

  it('produces valid JSON for other hosts and token snippets', () => {
    expect(JSON.parse(genericJsonConfig(URL)).mcpServers.bluetab).toEqual({ type: 'http', url: URL });
    const snippets = personalTokenSnippets(URL, 'btmcp_x');
    expect(snippets.every((snippet) => snippet.code.includes('btmcp_x'))).toBe(true);
    expect(snippets.some((snippet) => snippet.code.includes('2025-03-26'))).toBe(false);
  });

  it('maps upload errors and account probes', () => {
    expect(describeUploadFailure('network')).toBe('settings.mcp.failNetwork');
    expect(describeUploadFailure('http_401')).toBe('settings.mcp.failSignIn');
    expect(describeUploadFailure('http_403')).toBe('settings.mcp.failPro');
    expect(describeUploadFailure('http_500')).toBe('settings.mcp.failServer');
    expect(classifyAccountCheck(200)).toBe('ok');
    expect(classifyAccountCheck(401)).toBe('signIn');
    expect(classifyAccountCheck(403)).toBe('pro');
    expect(classifyAccountCheck(null)).toBe('unreachable');
  });

  it('derives the read-only and discovery URLs', () => {
    expect(readOnlyMcpUrl(URL)).toBe('https://supertry.net/api/mcp/readonly');
    expect(protectedResourceMetadataUrl(URL)).toBe('https://supertry.net/.well-known/oauth-protected-resource');
  });
});
