/**
 * @module sidepanel/components/PanelErrorBoundary
 *
 * WHY:  The side panel had no error boundary, so one render error in any tab
 *       (or a lazy tab chunk that failed to load) unmounted the whole React
 *       tree and left a blank panel until it was closed and reopened.
 *
 * WHAT: - Catches errors per panel and shows a small recovery card instead.
 *       - A failed chunk load (the build changed under an open panel, e.g.
 *         after an extension reload or a dev rebuild) reloads the panel once
 *         automatically; a second failure within a minute shows the card.
 *       - Writes the last error to chrome.storage.local
 *         (`sidepanel_last_error`) so a rare crash can be reported later
 *         without DevTools open, and logs it with console.error.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t as translate } from '@/i18n';

const LAST_ERROR_KEY = 'sidepanel_last_error';
const RELOAD_GUARD_KEY = 'bluetab:sidepanel-chunk-reload-at';
const RELOAD_GUARD_MS = 60_000;

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Loading chunk [\w-]+ failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/** Reload the panel for a stale chunk, at most once per minute. */
export function reloadOnceForChunkError(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || '0');
    if (now - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

function recordError(panel: string, error: Error, info?: ErrorInfo): void {
  console.error(`[BlueTab][Sidepanel] "${panel}" panel crashed:`, error, info?.componentStack ?? '');
  try {
    void chrome.storage.local.set({
      [LAST_ERROR_KEY]: {
        panel,
        message: `${error.name}: ${error.message}`.slice(0, 500),
        stack: (error.stack ?? '').slice(0, 2000),
        componentStack: (info?.componentStack ?? '').slice(0, 2000),
        at: Date.now(),
      },
    });
  } catch {
    // Storage is best effort; the console line above is the primary record.
  }
}

interface PanelErrorBoundaryProps {
  /** Short name used in logs, e.g. "ai" or "groups". */
  panel: string;
  children: ReactNode;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    recordError(this.props.panel, error, info);
    if (isChunkLoadError(error)) {
      reloadOnceForChunkError();
    }
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="h-full flex items-center justify-center p-4">
        <div className="w-full max-w-xs rounded-lg border border-border bg-bg-1/70 p-4 text-center space-y-3">
          <AlertTriangle className="mx-auto h-5 w-5 text-warning" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-strong">{translate('sidepanel.panelError.title')}</p>
            <p className="text-xs text-muted-foreground">{translate('sidepanel.panelError.description')}</p>
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={this.handleRetry}>
              {translate('sidepanel.panelError.tryAgain')}
            </Button>
            <Button size="sm" onClick={this.handleReload}>
              <RotateCw className="h-3.5 w-3.5 me-1.5" aria-hidden="true" />
              {translate('sidepanel.panelError.reload')}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * React.lazy loader that retries a failed dynamic import once before giving
 * up, which covers brief file-system or network hiccups.
 */
export function importWithRetry<T>(load: () => Promise<T>, delayMs = 400): () => Promise<T> {
  return () =>
    load().catch(
      (error: unknown) =>
        new Promise<T>((resolve, reject) => {
          setTimeout(() => {
            load().then(resolve, () => reject(error));
          }, delayMs);
        }),
    );
}

export default PanelErrorBoundary;
