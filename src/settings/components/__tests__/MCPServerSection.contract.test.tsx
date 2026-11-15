import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, '../MCPServerSection.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');

describe('MCPServerSection direct-enable contract', () => {
  it('does not import or render SnapshotConsentModal', () => {
    expect(source).not.toContain("import { SnapshotConsentModal }");
    expect(source).not.toContain('<SnapshotConsentModal');
  });

  it('does not gate enablement on mcp_server_consent_given_at', () => {
    expect(source).not.toContain("Storage.get<number>('mcp_server_consent_given_at')");
    expect(source).not.toContain('setConsentModalOpen(true)');
  });
});

describe('ChatGPT connection guide placement', () => {
  it('keeps the directory link in the ChatGPT tab behind the Pro gate', () => {
    const guide = fs.readFileSync(path.resolve(__dirname, '../mcp/McpConnectGuide.tsx'), 'utf-8');
    const chatgptTab = guide.match(/<TabsContent value="chatgpt"[^>]*>([\s\S]*?)<\/TabsContent>/)?.[1];

    expect(source).not.toContain('CHATGPT_DIRECTORY_URL');
    expect(source.indexOf('if (!isPro)')).toBeLessThan(source.indexOf('<McpConnectGuide'));
    expect(chatgptTab).toContain('href={CHATGPT_DIRECTORY_URL}');
    expect(chatgptTab).not.toContain('chatgptNote');
  });
});
