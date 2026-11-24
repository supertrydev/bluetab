import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_ROOT = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(COMPONENT_ROOT, relativePath), 'utf8');
}

describe('Settings RTL and bidi contract', () => {
  it('uses logical spacing and mirrors only directional settings arrows', () => {
    const files = [
      'ADHDSettings.tsx',
      'AboutSettings.tsx',
      'BackupSettings.tsx',
      'FloatingButtonSettings.tsx',
      'GeneralSettings.tsx',
      'GroupMemorySettings.tsx',
      'SidePanelSettings.tsx',
      'TabBehaviorSettings.tsx',
      'MCPServerSection.tsx',
      'PomodoroSettings.tsx',
      'ReminderSettings.tsx',
      'FeedsSettings.tsx',
      'integrations/IntegrationReauthBanner.tsx',
      'mcp/ConnectedClientCard.tsx',
    ];
    const source = files.map(read).join('\n');

    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr|space-x|border-l|border-r|text-left|text-right)-/);
    expect(read('ADHDSettings.tsx').match(/ArrowRight className="[^"]*rtl:rotate-180/g)).toHaveLength(3);
    expect(read('BackupSettings.tsx')).toMatch(/ChevronRight className="[^"]*rtl:rotate-180/);
  });

  it('keeps the settings shell search controls and text alignment direction-aware', () => {
    const source = read('../main.tsx');

    expect(source).not.toMatch(/\b(?:left|right|ml|mr|pl|pr|text-left|text-right)-/);
    expect(source.match(/absolute start-2\.5/g)).toHaveLength(2);
    expect(source.match(/absolute end-2/g)).toHaveLength(2);
    expect(source.match(/dir="auto"/g)).toHaveLength(2);
    expect(source).toContain("position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'}");
    expect(read('AboutSettings.tsx')).toContain("version: isolateBidi(version, 'ltr')");
  });

  it('isolates provider, account, workspace, project, and channel labels', () => {
    expect(read('integrations/IntegrationCard.tsx')).toMatch(
      /<bdi dir="auto"[^>]*>\s*\{entry\.display_name\}\s*<\/bdi>/,
    );
    expect(read('integrations/IntegrationAccountRow.tsx')).toMatch(
      /<bdi dir="auto"[^>]*>\{displayLabel\}<\/bdi>/,
    );
    expect(read('integrations/AsanaProjectSelector.tsx')).toContain(
      '<bdi dir="auto">{project.name}</bdi>',
    );
    expect(read('integrations/SlackChannelSelector.tsx')).toContain(
      '<bdi dir="auto">#{ch.name}</bdi>',
    );
    expect(read('integrations/NotionBrainDumpRouterFooter.tsx')).toContain(
      '<bdi dir="auto">{page.title || t(\'settings.integrations.untitled\')}</bdi>',
    );
    expect(read('integrations/GoogleCalendarSelector.tsx')).toContain(
      "t('settings.integrations.primaryLabel')",
    );
    expect(read('integrations/OutlookCalendarSelector.tsx')).toContain(
      "t('settings.integrations.primaryLabel')",
    );
  });

  it('keeps technical identifiers, URLs, timestamps, and numeric values LTR', () => {
    expect(read('integrations/GitHubRepoSelector.tsx')).toMatch(
      /<bdi dir="ltr"[^>]*>\{r\.fullName\}<\/bdi>/,
    );
    expect(read('integrations/JiraProjectSelector.tsx')).toContain(
      '<bdi dir="ltr">{project.key}</bdi>',
    );
    expect(read('mcp/ConnectedClientCard.tsx')).toMatch(
      /<time dir="ltr"[^>]*>\s*\{formatRelativeTime\(client\.lastUsedAt\)\}\s*<\/time>/,
    );
    expect(read('mcp/ConnectedClientCard.tsx')).toContain('<bdi dir="ltr">OAuth</bdi>');
    expect(read('SessionBackupSettings.tsx')).toMatch(
      /<time dir="ltr"[^>]*>\s*\{formatSnapshotDate\(snapshot\.timestamp\)\}/,
    );
    expect(read('FloatingButtonSettings.tsx')).toMatch(
      /FLOATING_BUTTON_HOST_ORIGINS[\s\S]*\.map\(\(origin\) => isolateBidi\(origin, 'ltr'\)\)/,
    );
  });

  it('lets validation and provider error text choose its own base direction', () => {
    expect(read('ADHDSettings.tsx')).toContain(
      '<p dir="auto" className="text-xs text-danger mb-2">{domainError}</p>',
    );
    expect(read('FocusSettings.tsx')).toContain(
      '<p dir="auto" className="text-xs text-danger mb-2">{domainError}</p>',
    );
    expect(read('integrations/NotionBrainDumpRouterFooter.tsx')).toContain(
      '<p dir="auto" className="text-xs text-destructive">{loadError}</p>',
    );
  });
});
