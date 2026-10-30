/**
 * @module settings/components/mcp/McpActivityList
 *
 * WHY:  People want to see what an AI app actually did with their data.
 * WHAT: Collapsible list of the latest MCP tool calls from
 *       GET {mcpUrl}/activity (tool, app, result, time). Loads on open.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/i18n/format';

interface ActivityRow {
  clientId: string;
  toolName: string;
  outcome: string;
  createdAt: number;
}

const OUTCOME_KEYS: Record<string, 'settings.mcp.outcomeSuccess' | 'settings.mcp.outcomeQueued' | 'settings.mcp.outcomeDenied' | 'settings.mcp.outcomeError'> = {
  success: 'settings.mcp.outcomeSuccess',
  queued: 'settings.mcp.outcomeQueued',
  replayed: 'settings.mcp.outcomeSuccess',
  denied: 'settings.mcp.outcomeDenied',
};

export function McpActivityList({
  mcpUrl,
  authToken,
  clientNames,
}: {
  mcpUrl: string;
  authToken: string | null;
  clientNames: Record<string, string>;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);

  const load = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${mcpUrl}/activity?limit=20`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        setRows([]);
        return;
      }
      setRows((await response.json()) as ActivityRow[]);
    } catch {
      setRows([]);
    }
  }, [authToken, mcpUrl]);

  return (
    <details
      className="group rounded-lg border border-border-glass bg-bg-1/60 p-3"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="cursor-pointer select-none list-none text-sm font-medium text-text-strong flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90">&#9654;</span>
        {t('settings.mcp.activityTitle')}
      </summary>
      <div className="pt-2">
        {rows === null ? null : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('settings.mcp.activityEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={`${row.createdAt}-${row.toolName}-${row.clientId}`} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="min-w-0 truncate">
                  <code dir="ltr" className="font-mono text-text-strong">{row.toolName}</code>
                  <span className="text-muted-foreground"> · <bdi dir="auto">{clientNames[row.clientId] ?? row.clientId}</bdi></span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {t(OUTCOME_KEYS[row.outcome] ?? 'settings.mcp.outcomeError')} ·{' '}
                  <time dir="ltr">{formatDateTime(new Date(row.createdAt))}</time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export default McpActivityList;
