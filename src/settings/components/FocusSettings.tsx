/**
 * @module settings/components/FocusSettings
 *
 * WHY:  Users need a central place to configure Focus Mode: toggle it on/off,
 *       start/stop focus manually, select which preset categories to block,
 *       add custom domains to the blocklist, configure auto-enable with Pomodoro,
 *       and choose whether blocking persists during Pomodoro breaks.
 *
 * WHAT: Settings section with master toggle, manual Start/Stop Focus button,
 *       auto-enable with Pomodoro toggle, 4 preset category toggles with
 *       example domains, custom domain input with add/remove, and a
 *       block-during-breaks toggle.
 *
 * HOW:  - Loads focusSettings and focusState from Storage on mount
 *       - Listens to chrome.storage.onChanged for external updates
 *       - Saves each change to Storage immediately
 *       - Sends TOGGLE_FOCUS message to service worker for manual control
 *       - Uses DEFAULT_FOCUS_SETTINGS as fallback when no settings exist
 *
 * NOT:  Does not directly activate/deactivate focus blocking -- that is
 *       service-worker.ts reacting to TOGGLE_FOCUS messages via FocusService.
 */

import { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, X, ScanSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { Switch } from '@/components/ui/switch';
import { ToastManager } from '@/components/Toast';
import { Storage } from '@/utils/storage';
import { FOCUS_PRESETS, DEFAULT_FOCUS_SETTINGS, normalizeFocusSettings } from '@/config/focus-presets';
import { hasFocusSiteAccess, requestFocusSiteAccess } from '@/services/focus-site-access';
import { hasHistoryPermission, requestHistoryPermission } from '@/services/history-permission';
import type { FocusSettings as FocusSettingsType, FocusState } from '@/types/productivity';
import { useAuth } from '@/components/auth/useAuth';
import { ProBadge } from '@/components/auth/ProBadge';
import { hasMinimumHistoryDays } from '@/services/history-aggregator';
import { getUpgradeUrl } from '@/utils/feature-gate';
import { normalizeFocusDomain } from '@/utils/focus-domain';
import { DistractionScanModal } from './DistractionScanModal';

type PresetKey = keyof FocusSettingsType['presets'];

const PRESET_KEYS: PresetKey[] = ['socialMedia', 'newsMedia', 'entertainment', 'shopping'];

/** Shared with the AI chat `block_site` tool. */
const normalizeDomain = normalizeFocusDomain;

export function FocusSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<FocusSettingsType>(DEFAULT_FOCUS_SETTINGS);
  const [domainInput, setDomainInput] = useState('');
  const [phraseInput, setPhraseInput] = useState('');
  const [domainError, setDomainError] = useState('');
  const [focusActive, setFocusActive] = useState(false);
  const [focusSiteAccess, setFocusSiteAccess] = useState(false);

  // AI Distraction Detector gate states
  const { isPro } = useAuth();
  const [showScanModal, setShowScanModal] = useState(false);
  const [hasMinHistory, setHasMinHistory] = useState<boolean | null>(null);
  const [historyPermissionGranted, setHistoryPermissionGranted] = useState<boolean | null>(null);

  // Load settings and focus state on mount
  useEffect(() => {
    Storage.get<FocusSettingsType>('focusSettings').then((stored) => {
      if (stored) {
        const normalized = normalizeFocusSettings(stored);
        setSettings(normalized);
        setPhraseInput(normalized.blockedPhrases.join('\n'));
      }
    });
    Storage.get<FocusState>('focusState').then((s) => {
      setFocusActive(s?.isActive ?? false);
    });
    void hasFocusSiteAccess().then(setFocusSiteAccess);
  }, []);

  // Listen for external storage changes
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.focusSettings) {
        const normalized = normalizeFocusSettings(changes.focusSettings.newValue);
        setSettings(normalized);
        setPhraseInput(normalized.blockedPhrases.join('\n'));
      }
      if (changes.focusState) {
        setFocusActive(changes.focusState.newValue?.isActive ?? false);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  const refreshAIHistoryAccess = useCallback(async () => {
    const [historyReady, historyPermission] = await Promise.all([
      hasMinimumHistoryDays(7).catch(() => false),
      hasHistoryPermission().catch(() => false),
    ]);

    setHasMinHistory(historyReady);
    setHistoryPermissionGranted(historyPermission);
  }, []);

  // DETECT-10: Check minimum history gate + permission state once on mount
  useEffect(() => {
    void refreshAIHistoryAccess();
  }, [refreshAIHistoryAccess]);

  const saveSettings = useCallback(async (updated: FocusSettingsType) => {
    const normalized = normalizeFocusSettings(updated);
    setSettings(normalized);
    setPhraseInput(normalized.blockedPhrases.join('\n'));
    await Storage.set('focusSettings', normalized);
  }, []);

  const parseBlockedPhrases = useCallback((value: string) => {
    const unique = new Set<string>();
    for (const line of value.split('\n')) {
      const normalized = line.trim().toLowerCase();
      if (normalized) {
        unique.add(normalized);
      }
    }
    return Array.from(unique);
  }, []);

  const handleMasterToggle = useCallback(async () => {
    const newEnabled = !settings.enabled;
    const blockedDomainCount =
      (settings.presets.socialMedia ? FOCUS_PRESETS.socialMedia.length : 0) +
      (settings.presets.newsMedia ? FOCUS_PRESETS.newsMedia.length : 0) +
      (settings.presets.entertainment ? FOCUS_PRESETS.entertainment.length : 0) +
      (settings.presets.shopping ? FOCUS_PRESETS.shopping.length : 0) +
      settings.customDomains.length +
      settings.blockedPhrases.length;
    if (newEnabled && blockedDomainCount > 0 && !focusSiteAccess) {
      const granted = await requestFocusSiteAccess();
      setFocusSiteAccess(granted);
      if (!granted) {
        ToastManager.getInstance().error(t('settings.focus.siteAccessRequired'));
        return;
      }
    }
    await saveSettings({ ...settings, enabled: newEnabled });
    // Toggle ON: start blocking. Toggle OFF: service worker auto-disables via focusSettings listener.
    if (newEnabled) {
      try {
        await chrome.runtime.sendMessage({ type: 'TOGGLE_FOCUS' });
      } catch (err) {
        console.error('[FocusSettings] Enable error:', err);
      }
    }
  }, [focusSiteAccess, saveSettings, settings, t]);

  const handlePresetToggle = useCallback(
    async (key: PresetKey) => {
      if (!settings.presets[key] && !focusSiteAccess) {
        const granted = await requestFocusSiteAccess();
        setFocusSiteAccess(granted);
        if (!granted) {
          ToastManager.getInstance().error(t('settings.focus.siteAccessRequired'));
          return;
        }
      }
      saveSettings({
        ...settings,
        presets: { ...settings.presets, [key]: !settings.presets[key] },
      });
    },
    [focusSiteAccess, saveSettings, settings, t],
  );

  const handleAddDomain = useCallback(async () => {
    setDomainError('');
    const domain = normalizeDomain(domainInput);
    if (!domain) {
      setDomainError(t('settings.focus.invalidDomain'));
      return;
    }
    // Check for duplicates inside the custom list only.
    if (settings.customDomains.includes(domain)) {
      setDomainError(t('settings.focus.duplicateDomain'));
      return;
    }
    if (!focusSiteAccess) {
      const granted = await requestFocusSiteAccess();
      setFocusSiteAccess(granted);
      if (!granted) {
        setDomainError(t('settings.focus.domainSiteAccessRequired'));
        return;
      }
    }
    saveSettings({
      ...settings,
      customDomains: [...settings.customDomains, domain],
    });
    setDomainInput('');
  }, [domainInput, focusSiteAccess, saveSettings, settings, t]);

  const handleRemoveDomain = useCallback(
    (domain: string) => {
      saveSettings({
        ...settings,
        customDomains: settings.customDomains.filter((d) => d !== domain),
      });
    },
    [settings, saveSettings],
  );

  const handleDomainKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddDomain();
      }
    },
    [handleAddDomain],
  );

  const handleOpenScan = useCallback(() => {
    void (async () => {
      const permissionGranted =
        historyPermissionGranted === true ? true : await requestHistoryPermission();

      setHistoryPermissionGranted(permissionGranted);

      if (!permissionGranted) {
        ToastManager.getInstance().error(t('settings.focus.historyAccessRequired'));
        return;
      }

      void refreshAIHistoryAccess();
      setShowScanModal(true);
    })();
  }, [historyPermissionGranted, refreshAIHistoryAccess, t]);

  const totalBlockedDomains =
    (settings.presets.socialMedia ? FOCUS_PRESETS.socialMedia.length : 0) +
    (settings.presets.newsMedia ? FOCUS_PRESETS.newsMedia.length : 0) +
    (settings.presets.entertainment ? FOCUS_PRESETS.entertainment.length : 0) +
    (settings.presets.shopping ? FOCUS_PRESETS.shopping.length : 0) +
    settings.customDomains.length;
  const totalBlockedPhrases = settings.blockedPhrases.length;
  const presetMeta = {
    socialMedia: {
      label: t('settings.focus.presets.socialMedia.label'),
      examples: t('settings.focus.presets.socialMedia.examples'),
    },
    newsMedia: {
      label: t('settings.focus.presets.newsMedia.label'),
      examples: t('settings.focus.presets.newsMedia.examples'),
    },
    entertainment: {
      label: t('settings.focus.presets.entertainment.label'),
      examples: t('settings.focus.presets.entertainment.examples'),
    },
    shopping: {
      label: t('settings.focus.presets.shopping.label'),
      examples: t('settings.focus.presets.shopping.examples'),
    },
  } satisfies Record<PresetKey, { label: string; examples: string }>;
  const domainSummary = totalBlockedDomains > 0
    ? t('settings.focus.summaryDomainCount', { count: totalBlockedDomains })
    : null;
  const phraseSummary = totalBlockedPhrases > 0
    ? t('settings.focus.summaryPhraseCount', { count: totalBlockedPhrases })
    : null;
  const summaryText = domainSummary && phraseSummary
    ? t('settings.focus.summaryDomainsAndPhrases', { domains: domainSummary, phrases: phraseSummary })
    : domainSummary
      ? t('settings.focus.summaryDomainsOnly', { domains: domainSummary })
      : phraseSummary
        ? t('settings.focus.summaryPhrasesOnly', { phrases: phraseSummary })
        : null;

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5" />
        {t('settings.focus.title')}
      </h3>

      <div className="space-y-6">
        {/* Master Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.focus.masterLabel')}
            </p>
            <p className="text-xs text-muted-foreground">
              {(settings.autoEnableWithPomodoro ?? true)
                ? t('settings.focus.status.autoManaged')
                : focusActive
                  ? t('settings.focus.status.active')
                  : t('settings.focus.status.idle')}
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={handleMasterToggle}
            disabled={settings.autoEnableWithPomodoro ?? true}
            aria-label={t('settings.focus.enableAria')}
          />
        </div>

        {(settings.enabled || (settings.autoEnableWithPomodoro ?? true)) && (
          <>
            {/* Preset Categories */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                {t('settings.focus.blockedCategories')}
              </label>
              <div className="space-y-2">
                {PRESET_KEYS.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between p-3 border border-border rounded-lg"
                  >
                    <div className="min-w-0 flex-1 me-3">
                      <p className="text-sm font-medium text-foreground">
                        {presetMeta[key].label}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground whitespace-normal line-clamp-2">
                        {presetMeta[key].examples}
                      </p>
                    </div>
                    <Switch checked={settings.presets[key]} onCheckedChange={() => handlePresetToggle(key)} aria-label={presetMeta[key].label} />
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Domains */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                {t('settings.focus.customBlockedDomains')}
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  dir="ltr"
                  value={domainInput}
                  onChange={(e) => {
                    setDomainInput(e.target.value);
                    setDomainError('');
                  }}
                  onKeyDown={handleDomainKeyDown}
                  placeholder={t('settings.focus.domainPlaceholder')}
                  className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={handleAddDomain}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('common.add')}
                </button>
              </div>
              {domainError && (
                <p dir="auto" className="text-xs text-red-500 mb-2">{domainError}</p>
              )}
              {settings.customDomains.length > 0 && (
                <div className="border border-border rounded-lg divide-y divide-border">
                  {settings.customDomains.map((domain) => (
                    <div
                      key={domain}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <bdi dir="ltr" className="text-foreground">{domain}</bdi>
                      <button
                        onClick={() => handleRemoveDomain(domain)}
                        className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                        title={t('settings.focus.removeDomainTitle', { domain: isolateBidi(domain, 'ltr') })}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                {t('settings.focus.blockedPhrasesTitle')}
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                {t('settings.focus.blockedPhrasesDescription')}
              </p>
              <textarea
                value={phraseInput}
                onChange={(e) => setPhraseInput(e.target.value)}
                onBlur={() => {
                  const nextPhrases = parseBlockedPhrases(phraseInput);
                  if (nextPhrases.join('\n') === settings.blockedPhrases.join('\n')) {
                    setPhraseInput(settings.blockedPhrases.join('\n'));
                    return;
                  }
                  void saveSettings({
                    ...settings,
                    blockedPhrases: nextPhrases,
                  });
                }}
                placeholder={t('settings.focus.blockedPhrasesPlaceholder')}
                rows={4}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Summary */}
            {summaryText && (
              <p className="text-xs text-muted-foreground">
                {summaryText}
              </p>
            )}

            {/* AI-suggested domains subsection (DETECT-01, DETECT-09, DETECT-10) */}
            <div className="border-t border-border pt-4">
              <div className="mb-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('settings.focus.aiSuggestedTitle')}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('settings.focus.aiSuggestedDescription')}
                </p>
              </div>

              {isPro ? (
                <button
                  onClick={handleOpenScan}
                  title={
                    !historyPermissionGranted
                      ? t('settings.focus.scanTitleGrant')
                      : hasMinHistory === false
                      ? t('settings.focus.scanTitleInsufficient')
                      : t('settings.focus.scanTitleReady')
                  }
                  className="
                    inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg
                    border border-border text-foreground
                    hover:bg-accent transition-colors
                  "
                >
                  <ScanSearch className="w-4 h-4" />
                  {t('settings.focus.scanCta')}
                </button>
              ) : (
                /* Free users: Pro badge + upgrade navigation (DETECT-09 refined) */
                <button
                  onClick={() => {
                    chrome.tabs.create({ url: getUpgradeUrl() });
                  }}
                  className="
                    inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg
                    border border-border text-foreground
                    hover:bg-accent transition-colors
                  "
                >
                  <ScanSearch className="w-4 h-4" />
                  {t('settings.focus.scanCta')}
                  <ProBadge size="sm" />
                </button>
              )}

              {isPro && !historyPermissionGranted && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  {t('settings.focus.historyPermissionHint')}
                </p>
              )}
              {isPro && historyPermissionGranted && hasMinHistory === false && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  {t('settings.focus.minimumHistoryHint')}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* DistractionScanModal (mounted here so it renders over the settings page) */}
      <DistractionScanModal
        open={showScanModal}
        onClose={() => setShowScanModal(false)}
      />
    </div>
  );
}
