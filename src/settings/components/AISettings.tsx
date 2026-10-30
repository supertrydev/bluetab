/**
 * @module settings/components/AISettings
 *
 * WHY:  Users need control over AI Assistant behaviour and the ability to wipe
 *       stored AI conversation history for privacy.
 *
 * WHAT: Settings section with smart group naming, a "Clear AI History"
 *       destructive button, server-backed AI allowance summary, and a
 *       lightweight history-access guidance for AI features that request
 *       browser permission at the moment of use.
 *
 * HOW:  - Loads ai_settings from Storage on mount, merged with DEFAULT_AI_SETTINGS
 *       - Each setting change saves immediately via Storage.set('ai_settings', …)
 *       - Clear history delegates to AIService.clearHistory() and broadcasts a
 *         runtime reset so any open sidepanel chat clears immediately
 *       - Allowance summary subscribes to AIAllowanceService.subscribeToSummary
 *       - History access is requested directly from feature entrypoints
 *
 * NOT:  Does not handle AI execution, chat, or tool calls — those are in the
 *       AI service layer and sidepanel.
 *
 * PRIVACY-02 mitigated-by-design:
 *   The "What Bluetab AI saw last run" audit log is explicitly descoped for
 *   Phase 11. Aggregated-domain-only defaults, just-in-time browser permission,
 *   and the remote kill switch are the active mitigations. No audit log is built here.
 */

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Storage } from '@/utils/storage';
import { AIService } from '@/services/ai-service';
import { AIAllowanceService, formatAllowancePercent } from '@/services/ai-allowance-service';
import type { AIAllowanceSummary } from '@/services/ai-allowance-service';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';
import type { AISettings as AISettingsConfig } from '@/types/ai';
import { useAINotice } from '@/components/ai/AINoticeDialog';
import { getLocaleTag } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Toggle sub-component (matches FocusSettings inline toggle pattern)
// ---------------------------------------------------------------------------

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}

function SettingToggle({ checked, onChange, label, description }: ToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AISettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AISettingsConfig>(DEFAULT_AI_SETTINGS);
  const [historyCleared, setHistoryCleared] = useState(false);
  const [allowance, setAllowance] = useState<AIAllowanceSummary | null>(null);
  const { showNotice, showNoticeOnce, noticeDialog } = useAINotice();

  // One-time AI data notice. Shown automatically when another surface
  // (e.g. page summary) sent the user here with #ai before seeing it.
  useEffect(() => {
    if (window.location.hash === '#ai') void showNoticeOnce();
  }, [showNoticeOnce]);

  // Load settings on mount, merge with defaults for any missing keys
  useEffect(() => {
    Storage.get<Partial<AISettingsConfig>>('ai_settings').then((stored) => {
      if (stored) {
        setSettings({ ...DEFAULT_AI_SETTINGS, ...stored });
      }
    });
  }, []);

  // Subscribe to allowance summary — re-renders on every ai_allowance_summary change
  useEffect(() => {
    const unsubscribe = AIAllowanceService.subscribeToSummary((summary) => {
      setAllowance(summary);
    });
    void AIAllowanceService.refresh();
    return unsubscribe;
  }, []);

  const saveSettings = useCallback(async (updated: AISettingsConfig) => {
    setSettings(updated);
    await Storage.set('ai_settings', updated);
  }, []);

  const handleSmartNamingToggle = useCallback(() => {
    saveSettings({ ...settings, smartNaming: !settings.smartNaming });
  }, [settings, saveSettings]);

  const handleAlwaysAllowIntegrationsToggle = useCallback(() => {
    saveSettings({ ...settings, alwaysAllowIntegrationActions: !settings.alwaysAllowIntegrationActions });
  }, [settings, saveSettings]);

  const handleClearHistory = useCallback(async () => {
    await AIService.clearHistory();
    try {
      await chrome.runtime.sendMessage({ type: 'AI_HISTORY_CLEARED' });
    } catch {
      // No active receiver is fine; persistence has already been cleared.
    }
    setHistoryCleared(true);
    // Reset confirmation text after 2 seconds
    setTimeout(() => setHistoryCleared(false), 2000);
  }, []);

  const allowancePeriodLabel = allowance?.periodEnd
    ? new Date(allowance.periodEnd).toLocaleDateString(getLocaleTag())
    : null;

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5" />
        {t('settings.ai.title')}
      </h3>

      <div className="space-y-6">
        {noticeDialog}

        {/* Smart Group Naming toggle */}
        <SettingToggle
          checked={settings.smartNaming}
          onChange={handleSmartNamingToggle}
          label={t('settings.ai.smartNamingLabel')}
          description={t('settings.ai.smartNamingDescription')}
        />

        {/* Connected-app actions from AI chat: confirm each one, or not */}
        <SettingToggle
          checked={settings.alwaysAllowIntegrationActions}
          onChange={handleAlwaysAllowIntegrationsToggle}
          label={t('settings.ai.alwaysAllowIntegrationsLabel')}
          description={t('settings.ai.alwaysAllowIntegrationsDescription')}
        />

        {/* Clear AI History */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.ai.clearHistoryLabel')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('settings.ai.clearHistoryDescription')}
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {historyCleared && (
              <span className="text-xs text-green-600 dark:text-green-400">{t('settings.ai.historyCleared')}</span>
            )}
            <button
              onClick={handleClearHistory}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              {t('settings.ai.clearHistoryButton')}
            </button>
          </div>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Usage & privacy — server-backed allowance summary + history access guidance */}
        {/* ----------------------------------------------------------------- */}
        <div className="pt-4 border-t border-border space-y-3">
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-primary" />
            {t('settings.ai.usageAndPrivacy')}
          </h4>

          {/* AI allowance summary */}
          {allowance?.eligible && (() => {
            const colorClass = allowance.percentUsed > 95
              ? 'text-red-500'
              : allowance.percentUsed > 80
              ? 'text-amber-500'
              : 'text-muted-foreground';
            return (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{t('settings.ai.allowanceUsed')}</span>
                <span className={colorClass}>
                  <bdi dir="ltr">{formatAllowancePercent(allowance.percentUsed)}</bdi>
                  {allowancePeriodLabel && (
                    <span dir="auto" className="text-xs text-muted-foreground ms-2">
                      {t('settings.ai.periodEnds', { date: isolateBidi(allowancePeriodLabel, 'ltr') })}
                    </span>
                  )}
                </span>
              </div>
            );
          })()}

          <p className="text-xs text-muted-foreground">
            {t('settings.ai.historyAccessDescription')}
          </p>

          <button
            type="button"
            onClick={showNotice}
            className="text-xs text-primary underline underline-offset-2 hover:text-primary-hover"
          >
            {t('settings.ai.dataNoticeLink')}
          </button>
        </div>
      </div>
    </div>
  );
}
