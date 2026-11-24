/**
 * @module settings/components/mcp/McpConnectionTest
 *
 * WHY:  "Is it working?" was the first question after turning MCP on and the
 *       page could not answer it. This runs the three things that must be
 *       true for an AI app to see BlueTab data and shows each result.
 *
 * WHAT: 1. Server reachable: the OAuth protected-resource document loads and
 *          names this MCP URL (AI apps start sign-in from it).
 *       2. Account: the signed-in session can list MCP apps (401 = sign in
 *          again, 403 = BlueTab Pro needed).
 *       3. Snapshot: uploads one now and reads the result.
 *
 * NOT:  Does not call tools/list. That needs an MCP access token, which only
 *       the AI app holds after its own OAuth sign-in.
 */

import { useCallback, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { MCPServerService } from '@/services/mcp-server-service';
import { Storage } from '@/utils/storage';
import {
  classifyAccountCheck,
  describeUploadFailure,
  protectedResourceMetadataUrl,
} from './mcp-connect';

interface CheckResult {
  ok: boolean;
  label: string;
}

interface McpConnectionTestProps {
  url: string;
  authToken: string | null;
  enabled: boolean;
  onFinished?: () => void;
}

async function probeServer(url: string): Promise<boolean> {
  try {
    const response = await fetch(protectedResourceMetadataUrl(url), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { resource?: string };
    return body.resource === url;
  } catch {
    return false;
  }
}

async function probeAccount(url: string, authToken: string | null): Promise<number | null> {
  if (!authToken) return 401;
  try {
    const response = await fetch(`${url}/clients`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

export function McpConnectionTest({ url, authToken, enabled, onFinished }: McpConnectionTestProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CheckResult[] | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setResults(null);
    try {
      const [serverOk, accountStatus] = await Promise.all([probeServer(url), probeAccount(url, authToken)]);
      const account = classifyAccountCheck(accountStatus);

      let snapshot: CheckResult;
      if (!enabled) {
        snapshot = { ok: false, label: t('settings.mcp.testSnapshotOff') };
      } else {
        await MCPServerService.pushSnapshotIfEnabled().catch(() => {});
        const status = await Storage.get<{ lastPushOk?: boolean; lastError?: string }>('mcp_server_status');
        snapshot = status?.lastPushOk
          ? { ok: true, label: t('settings.mcp.testSnapshot') }
          : { ok: false, label: t('settings.mcp.statusFailed', { reason: t(describeUploadFailure(status?.lastError)) }) };
      }

      setResults([
        { ok: serverOk, label: serverOk ? t('settings.mcp.testServer') : t('settings.mcp.testServerFail') },
        {
          ok: account === 'ok',
          label:
            account === 'ok'
              ? t('settings.mcp.testAccount')
              : account === 'pro'
                ? t('settings.mcp.testAccountPro')
                : account === 'signIn'
                  ? t('settings.mcp.testAccountSignIn')
                  : t('settings.mcp.testServerFail'),
        },
        snapshot,
      ]);
    } finally {
      setRunning(false);
      onFinished?.();
    }
  }, [authToken, enabled, onFinished, t, url]);

  const allGood = results?.every((result) => result.ok) ?? false;

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={run} disabled={running}>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {running ? t('settings.mcp.testing') : t('settings.mcp.testConnection')}
      </Button>
      {results && (
        <ul aria-live="polite" className="space-y-1">
          {results.map((result) => (
            <li key={result.label} className="flex items-center gap-1.5 text-xs">
              {result.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true" />
              ) : (
                <CircleAlert className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden="true" />
              )}
              <span className={result.ok ? 'text-text' : 'text-text-strong'}>{result.label}</span>
            </li>
          ))}
          {allGood && <li className="text-xs text-muted-foreground pt-1">{t('settings.mcp.testAllGood')}</li>}
        </ul>
      )}
    </div>
  );
}

export default McpConnectionTest;
