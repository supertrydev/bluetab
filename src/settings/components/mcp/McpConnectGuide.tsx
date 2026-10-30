/**
 * @module settings/components/mcp/McpConnectGuide
 *
 * WHY:  Most people connect BlueTab to one app. A tab per app with two or
 *       three plain steps (and a one-click button where the app has one)
 *       beats a wall of config files.
 *
 * WHAT: Tabs for Claude, ChatGPT, Cursor, VS Code, Claude Code, Codex,
 *       Gemini CLI and "Other". All of them use OAuth; personal tokens live
 *       in the Advanced section of MCPServerSection.
 */

import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeBlock } from './McpCode';
import {
  CHATGPT_SETTINGS_URL,
  CLAUDE_CONNECTORS_URL,
  MCP_APPS,
  buildCursorInstallLink,
  buildVsCodeInstallLink,
  cliCommands,
  genericJsonConfig,
} from './mcp-connect';

const LINK_BUTTON =
  'inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-1.5 ps-5 text-xs text-text">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

function CliGuide({ app, url }: { app: 'claude-code' | 'codex' | 'gemini'; url: string }) {
  const { t } = useTranslation();
  const commands = cliCommands(app, url);
  return (
    <div className="space-y-2">
      <p className="text-xs text-text">{t('settings.mcp.cliStep')}</p>
      <CodeBlock code={commands.add} />
      {commands.signIn && (
        <>
          <p className="text-xs text-text pt-1">{t('settings.mcp.cliSignIn')}</p>
          <CodeBlock code={commands.signIn} />
        </>
      )}
      <p className="text-xs text-muted-foreground">{t('settings.mcp.approveStep')}</p>
    </div>
  );
}

export function McpConnectGuide({ url }: { url: string }) {
  const { t } = useTranslation();

  return (
    <Tabs defaultValue="claude" className="space-y-3">
      <TabsList
        aria-label={t('settings.mcp.chooseApp')}
        className="h-auto flex-wrap justify-start gap-1 rounded-2xl"
      >
        {MCP_APPS.map((app) => (
          <TabsTrigger key={app.id} value={app.id}>
            <bdi dir="ltr">{app.label}</bdi>
          </TabsTrigger>
        ))}
        <TabsTrigger value="other">{t('settings.mcp.otherApp')}</TabsTrigger>
      </TabsList>

      <TabsContent value="claude" className="space-y-3">
        <Steps items={[t('settings.mcp.claudeStep1'), t('settings.mcp.claudeStep2'), t('settings.mcp.approveStep')]} />
        <a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
          {t('settings.mcp.openClaude')}
          <ExternalLink className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
        </a>
      </TabsContent>

      <TabsContent value="chatgpt" className="space-y-3">
        <Steps items={[t('settings.mcp.chatgptStep1'), t('settings.mcp.chatgptStep2'), t('settings.mcp.approveStep')]} />
        <p className="text-xs text-muted-foreground">{t('settings.mcp.chatgptNote')}</p>
        <a href={CHATGPT_SETTINGS_URL} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
          {t('settings.mcp.openChatgpt')}
          <ExternalLink className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
        </a>
      </TabsContent>

      <TabsContent value="cursor" className="space-y-3">
        <p className="text-xs text-text">{t('settings.mcp.cursorStep')}</p>
        <a href={buildCursorInstallLink(url)} className={LINK_BUTTON}>
          {t('settings.mcp.addToCursor')}
        </a>
      </TabsContent>

      <TabsContent value="vscode" className="space-y-3">
        <p className="text-xs text-text">{t('settings.mcp.vscodeStep')}</p>
        <a href={buildVsCodeInstallLink(url)} className={LINK_BUTTON}>
          {t('settings.mcp.addToVscode')}
        </a>
      </TabsContent>

      <TabsContent value="claude-code">
        <CliGuide app="claude-code" url={url} />
      </TabsContent>
      <TabsContent value="codex">
        <CliGuide app="codex" url={url} />
      </TabsContent>
      <TabsContent value="gemini">
        <CliGuide app="gemini" url={url} />
      </TabsContent>

      <TabsContent value="other" className="space-y-2">
        <p className="text-xs text-text">{t('settings.mcp.otherStep')}</p>
        <CodeBlock code={genericJsonConfig(url)} />
      </TabsContent>
    </Tabs>
  );
}

export default McpConnectGuide;
