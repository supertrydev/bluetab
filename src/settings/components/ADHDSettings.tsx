/**
 * @module settings/components/ADHDSettings
 *
 * WHY:  Phase 9 introduces a master ADHD Mode toggle plus calm-surface
 *       sub-features (Safe Auto-Suspend, Simplify, Visual Time). Users need
 *       one place to see the shape of the feature before opting in, then
 *       toggle each sub-piece independently once the master is on. Brain
 *       Dump now lives in its own first-class Settings tab.
 *
 * WHAT: - Section header "ADHD Mode" with Brain icon (Phase 8.1 pattern)
 *       - Short descriptive paragraph in English
 *       - Master "Enable ADHD Mode" toggle at top
 *       - Sub-toggle rows for the ADHD Mode bundle — each always rendered
 *         so users see the shape of
 *         the feature before enabling. Sub-toggles are `disabled` when
 *         the master is off (Radix Switch disabled prop, not
 *         pointer-events-none on the wrapper — preserves a11y)
 *       - Visual dim via opacity-50 on the sub-toggle container when
 *         master is OFF
 *       - Explanatory note under the sub-toggles when master is OFF:
 *         "Enable ADHD Mode to use these features."
 *
 * HOW:  - Load ADHDSettings via ADHDService.getSettings on mount
 *       - Subscribe via ADHDService.subscribe for cross-tab/cross-device
 *         updates (the delta-tracker sync wiring in 09-01 Task 2 makes
 *         this reactive across devices)
 *       - Each toggle's onCheckedChange calls ADHDService.updateSettings
 *         with a partial patch; the service handles deep-merge and storage
 *
 * NOT:  - No per-sub-feature settings here (thresholds, whitelists, etc.).
 *         Each sub-plan adds its own surface INSIDE this tab in Wave 2/3.
 *       - Does not implement data-simplify attribute writing — that is
 *         useSimplifyMode (stub in 09-01, filled in 09-04).
 *       - Does not enforce SAFETY-02 at runtime — the CI grep does.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { ArrowRight, Brain, Clock, Coffee, Globe2, Lock, PanelTop, Plus, X } from 'lucide-react';
import { ToastManager } from '@/components/Toast';
import { computeBreakMinutes } from '@/services/flowtime-helpers';
import {
  FLOWTIME_COEFFICIENT_MIN,
  FLOWTIME_COEFFICIENT_MAX,
  FLOWTIME_COEFFICIENT_DEFAULT,
} from '@/services/flowtime-helpers';
import { requestFocusSiteAccess } from '@/services/focus-site-access';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ADHDService } from '@/services/adhd-service';
import {
  DEFAULT_ADHD_SETTINGS,
  type ADHDFeatureName,
  type ADHDSettings as ADHDSettingsType,
} from '@/types/adhd';
import { AutoSuspendOnboardingDialog } from './AutoSuspendOnboardingDialog';

/**
 * Domain normalizer — duplicated from FocusSettings.tsx (keeps feature
 * separation per CONVENTIONS.md). Strips protocol / www. / trailing path
 * so the user can paste "https://www.github.com/" and we store "github.com".
 */
function normalizeDomain(input: string): string | null {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.split('/')[0];
  domain = domain.split(':')[0];
  if (!domain || !domain.includes('.') || domain.includes(' ')) return null;
  return domain;
}

// 0.5 (= 30 seconds) stays available for support/testing without exposing
// debug wording in the user-facing label.
const THRESHOLD_OPTIONS = [0.5, 15, 30, 60, 120] as const;

interface SubToggleMeta {
  name: ADHDFeatureName;
  label: string;
  description: string;
}

// CONTEXT.md §ADHD Settings Layout — order: Visual Time, Flowtime Timer,
// Safe Auto-Suspend, Visible Tab Limit, Simplify Mode, Hard Focus.
// This array is REORDERED (not extended from the Phase 9 order) per 12-RESEARCH Finding 12.
export function ADHDSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ADHDSettingsType>(DEFAULT_ADHD_SETTINGS);
  // Auto-Suspend sub-section local state (whitelist input, onboarding dialog).
  const [domainInput, setDomainInput] = useState('');
  const [domainError, setDomainError] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // Phase 12: first-enable onboarding card visibility per new sub-feature.
  const [vtlOnboardingVisible, setVtlOnboardingVisible] = useState(false);
  const [hardFocusOnboardingVisible, setHardFocusOnboardingVisible] = useState(false);
  const [flowtimeOnboardingVisible, setFlowtimeOnboardingVisible] = useState(false);

  // Load current settings on mount.
  useEffect(() => {
    let cancelled = false;
    ADHDService.getSettings().then((current) => {
      if (!cancelled) setSettings(current);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to cross-tab / cross-device changes.
  useEffect(() => {
    const unsubscribe = ADHDService.subscribe((next) => setSettings(next));
    return unsubscribe;
  }, []);

  const handleMasterToggle = useCallback((next: boolean) => {
    ADHDService.updateSettings({ masterEnabled: next }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] master toggle error:', err);
    });
  }, []);

  const handleSubToggle = useCallback(
    (name: ADHDFeatureName, next: boolean) => {
      ADHDService.updateSettings({ [name]: { enabled: next } }).catch((err) => {
        console.error(`[BlueTab][ADHDSettings] ${name} toggle error:`, err);
      });
      // ADHD-09 — first-run Auto-Suspend onboarding dialog. Fires exactly
      // once per profile (onboardingSeen is sticky) on enable.
      if (name === 'autoSuspend' && next && settings.autoSuspend.onboardingSeen !== true) {
        setOnboardingOpen(true);
      }
      // Phase 12 — first-enable onboarding cards for the three new sub-features.
      if (name === 'visibleTabLimit' && next && settings.visibleTabLimit?.onboardingSeen !== true) {
        setVtlOnboardingVisible(true);
      }
      if (name === 'hardFocus' && next && settings.hardFocus?.onboardingSeen !== true) {
        setHardFocusOnboardingVisible(true);
      }
      if (name === 'flowtimeTimer' && next && settings.flowtimeTimer?.onboardingSeen !== true) {
        setFlowtimeOnboardingVisible(true);
      }
    },
    [
      settings.autoSuspend.onboardingSeen,
      settings.visibleTabLimit?.onboardingSeen,
      settings.hardFocus?.onboardingSeen,
      settings.flowtimeTimer?.onboardingSeen,
    ],
  );

  // Simplify Aggressive sub-flag — hover-reveals decorative group metadata
  // on Options-shell group rows only. See useSimplifyMode + simplify.css.
  const handleSimplifyAggressive = useCallback((next: boolean) => {
    ADHDService.updateSettings({ simplify: { aggressive: next } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] simplify aggressive toggle error:', err);
    });
  }, []);

  // Visual Time color-blind-safe palette toggle — swaps the default palette
  // for the Okabe-Ito pair (#E69F00 / #0072B2) inside VisualTimeDisc.
  const handleVisualTimeColorBlindSafe = useCallback((next: boolean) => {
    ADHDService.updateSettings({ visualTime: { colorBlindSafe: next } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] visualTime colorBlindSafe toggle error:', err);
    });
  }, []);

  // Phase 12 — Visible Tab Limit slider.
  // Also dispatches VTL_RECONCILE so VisibleTabLimitService runs immediately.
  const handleVtlLimitChange = useCallback((value: number) => {
    ADHDService.updateSettings({ visibleTabLimit: { limit: value } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] vtl limit error:', err);
    });
    chrome.runtime.sendMessage({ type: 'VTL_RECONCILE' }).catch(() => {
      // Service worker may be inactive; it will reconcile on next startup.
    });
  }, []);

  const handleVtlOnboardingDismiss = useCallback(() => {
    setVtlOnboardingVisible(false);
    ADHDService.updateSettings({ visibleTabLimit: { onboardingSeen: true } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] vtl onboarding mark error:', err);
    });
  }, []);

  // Phase 12 — Hard Focus domain-mode sub-toggle.
  const handleHardFocusDomainMode = useCallback((next: boolean) => {
    ADHDService.updateSettings({ hardFocus: { domainMode: next } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] hardFocus domainMode error:', err);
    });
  }, []);

  const handleHardFocusOnboardingDismiss = useCallback(() => {
    setHardFocusOnboardingVisible(false);
    ADHDService.updateSettings({ hardFocus: { onboardingSeen: true } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] hardFocus onboarding mark error:', err);
    });
  }, []);

  // Phase 12 — Flowtime coefficient slider.
  const handleFlowtimeCoefficientChange = useCallback((value: number) => {
    ADHDService.updateSettings({ flowtimeTimer: { coefficient: value } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] flowtimeTimer coefficient error:', err);
    });
  }, []);

  const handleFlowtimeAutoFocus = useCallback(async (next: boolean) => {
    if (next) {
      const granted = await requestFocusSiteAccess();
      if (!granted) {
        ToastManager.getInstance().error({ key: 'feedback.flowtimeAutoFocusSiteAccessRequired' });
        return;
      }
    }

    ADHDService.updateSettings({ flowtimeTimer: { autoFocusEnabled: next } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] flowtimeTimer auto-focus error:', err);
    });
  }, []);

  const handleFlowtimeOnboardingDismiss = useCallback(() => {
    setFlowtimeOnboardingVisible(false);
    ADHDService.updateSettings({ flowtimeTimer: { onboardingSeen: true } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] flowtimeTimer onboarding mark error:', err);
    });
  }, []);

  const handleOnboardingClose = useCallback(() => {
    setOnboardingOpen(false);
    ADHDService.updateSettings({ autoSuspend: { onboardingSeen: true } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] onboarding dismiss error:', err);
    });
  }, []);

  const handleThresholdChange = useCallback((value: string) => {
    const n = Number(value) as 0.5 | 15 | 30 | 60 | 120;
    if (!THRESHOLD_OPTIONS.includes(n as (typeof THRESHOLD_OPTIONS)[number])) return;
    ADHDService.updateSettings({ autoSuspend: { thresholdMin: n } }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] threshold update error:', err);
    });
  }, []);

  const handleAddDomain = useCallback(() => {
    setDomainError('');
    const domain = normalizeDomain(domainInput);
    if (!domain) {
      setDomainError(t('settings.adhd.invalidDomain'));
      return;
    }
    if (settings.autoSuspend.whitelistDomains.includes(domain)) {
      setDomainError(t('settings.adhd.duplicateDomain'));
      return;
    }
    ADHDService.updateSettings({
      autoSuspend: {
        whitelistDomains: [...settings.autoSuspend.whitelistDomains, domain],
      },
    }).catch((err) => {
      console.error('[BlueTab][ADHDSettings] whitelist add error:', err);
    });
    setDomainInput('');
  }, [domainInput, settings.autoSuspend.whitelistDomains, t]);

  const handleRemoveDomain = useCallback(
    (domain: string) => {
      ADHDService.updateSettings({
        autoSuspend: {
          whitelistDomains: settings.autoSuspend.whitelistDomains.filter((d) => d !== domain),
        },
      }).catch((err) => {
        console.error('[BlueTab][ADHDSettings] whitelist remove error:', err);
      });
    },
    [settings.autoSuspend.whitelistDomains],
  );

  const master = settings.masterEnabled;
  const autoSuspendActive = master && settings.autoSuspend.enabled;
  const simplifyActive = master && settings.simplify.enabled;
  const visualTimeActive = master && settings.visualTime.enabled;
  // Phase 12 active flags
  const flowtimeActive = master && (settings.flowtimeTimer?.enabled ?? false);
  const vtlActive = master && (settings.visibleTabLimit?.enabled ?? false);
  const hardFocusActive = master && (settings.hardFocus?.enabled ?? false);

  // Flowtime live preview (ADHD Settings coefficient slider)
  const flowtimeCoeff = settings.flowtimeTimer?.coefficient ?? FLOWTIME_COEFFICIENT_DEFAULT;
  const flowtimePreview = {
    thirty: computeBreakMinutes(30, flowtimeCoeff) ?? 6,
    sixty: computeBreakMinutes(60, flowtimeCoeff) ?? 12,
    oneTwenty: computeBreakMinutes(120, flowtimeCoeff) ?? 24,
  };
  const subToggles: readonly SubToggleMeta[] = [
    {
      name: 'visualTime',
      label: t('settings.adhd.subToggles.visualTime.label'),
      description: t('settings.adhd.subToggles.visualTime.description'),
    },
    {
      name: 'flowtimeTimer',
      label: t('settings.adhd.subToggles.flowtimeTimer.label'),
      description: t('settings.adhd.subToggles.flowtimeTimer.description'),
    },
    {
      name: 'autoSuspend',
      label: t('settings.adhd.subToggles.autoSuspend.label'),
      description: t('settings.adhd.subToggles.autoSuspend.description'),
    },
    {
      name: 'visibleTabLimit',
      label: t('settings.adhd.subToggles.visibleTabLimit.label'),
      description: t('settings.adhd.subToggles.visibleTabLimit.description'),
    },
    {
      name: 'simplify',
      label: t('settings.adhd.subToggles.simplify.label'),
      description: t('settings.adhd.subToggles.simplify.description'),
    },
    {
      name: 'hardFocus',
      label: t('settings.adhd.subToggles.hardFocus.label'),
      description: t('settings.adhd.subToggles.hardFocus.description'),
    },
  ] as const;

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5" />
        {t('settings.adhd.title')}
      </h3>

      <p className="text-sm text-muted-foreground mb-6 max-w-prose">
        {t('settings.adhd.description')}
      </p>

      <div className="space-y-6">
        {/* Master Toggle */}
        <div className="flex items-center justify-between">
          <div className="pe-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('settings.adhd.masterTitle')}
            </p>
            <p className="text-xs text-muted-foreground">
              {master
                ? t('settings.adhd.masterEnabledDescription')
                : t('settings.adhd.masterDisabledDescription')}
            </p>
          </div>
          <Switch
            checked={master}
            onCheckedChange={handleMasterToggle}
            aria-label={t('settings.adhd.masterTitle')}
          />
        </div>

        {/* Sub-toggles — always rendered. Dimmed + disabled when master is OFF
            so the user can see the shape of the feature before committing.
            Using `disabled` on each Switch (not pointer-events-none on the
            wrapper) preserves focus + screen-reader navigation. */}
        <div
          className={`space-y-2 transition-opacity duration-150 ${
            master ? '' : 'opacity-50'
          }`}
          aria-disabled={!master}
        >
          {subToggles.map((meta) => (
            <div key={meta.name}>
              <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                <div className="min-w-0 flex-1 me-3">
                  <p className="text-sm font-medium text-foreground">{meta.label}</p>
                  <p className="text-xs text-muted-foreground">{meta.description}</p>
                </div>
                <Switch
                  checked={settings[meta.name].enabled}
                  onCheckedChange={(next) => handleSubToggle(meta.name, next)}
                  disabled={!master}
                  aria-label={meta.label}
                />
              </div>

              {/* Auto-Suspend sub-section — threshold dropdown + whitelist
                  chip-list. Rendered only when the master AND the
                  autoSuspend sub-toggle are both ON (ADHD-02 gate). */}
              {meta.name === 'autoSuspend' && autoSuspendActive && (
                <div className="mt-3 ms-3 ps-3 border-s-2 border-border space-y-4">
                  <p className="text-xs text-muted-foreground max-w-prose">
                    {t('settings.adhd.autoSuspendDescription')}
                  </p>

                  {/* Memory Saver conflict note — surfaced explicitly so
                      users can reason about the interaction when the browser's
                      native Memory Saver is enabled. See 09-CONTEXT.md
                      §Safe Auto-Suspend. */}
                  <p className="text-xs text-muted-foreground italic max-w-prose">
                    {t('settings.adhd.memorySaverNote')}
                  </p>

                  {/* Threshold dropdown (preset-only per CONTEXT.md) */}
                  <div>
                    <label
                      className="block text-xs font-medium text-foreground mb-2"
                      htmlFor="adhd-autosuspend-threshold"
                    >
                      {t('settings.adhd.inactivityThreshold')}
                    </label>
                    <Select
                      value={String(settings.autoSuspend.thresholdMin)}
                      onValueChange={handleThresholdChange}
                    >
                      <SelectTrigger
                        id="adhd-autosuspend-threshold"
                        className="w-[200px]"
                        aria-label={t('settings.adhd.inactivityThresholdAria')}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Debug-only preset for manual testing; clamped by 1-min alarm cadence so actual discard happens within ~60s */}
                        <SelectItem value="0.5">{t('settings.adhd.thresholdOptions.thirtySeconds')}</SelectItem>
                        <SelectItem value="15">{t('settings.adhd.thresholdOptions.fifteenMinutes')}</SelectItem>
                        <SelectItem value="30">{t('settings.adhd.thresholdOptions.thirtyMinutes')}</SelectItem>
                        <SelectItem value="60">{t('settings.adhd.thresholdOptions.oneHour')}</SelectItem>
                        <SelectItem value="120">{t('settings.adhd.thresholdOptions.twoHours')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Whitelist chip-list — cloned from FocusSettings pattern. */}
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-2">
                      {t('settings.adhd.whitelist')}
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
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddDomain();
                          }
                        }}
                        placeholder={t('settings.adhd.whitelistPlaceholder')}
                        aria-label={t('settings.adhd.whitelistAria')}
                        className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={handleAddDomain}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t('settings.adhd.addWhitelist')}
                      </button>
                    </div>
                    {domainError && (
                      <p dir="auto" className="text-xs text-red-500 mb-2">{domainError}</p>
                    )}
                    {settings.autoSuspend.whitelistDomains.length > 0 && (
                      <div className="border border-border rounded-lg divide-y divide-border">
                        {settings.autoSuspend.whitelistDomains.map((domain) => (
                          <div
                            key={domain}
                            className="flex items-center justify-between px-3 py-2 text-sm"
                          >
                            <bdi dir="ltr" className="text-foreground">{domain}</bdi>
                            <button
                              type="button"
                              onClick={() => handleRemoveDomain(domain)}
                              className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                              title={t('settings.adhd.removeDomainTitle', { domain: isolateBidi(domain, 'ltr') })}
                              aria-label={t('settings.adhd.removeDomainAria', { domain: isolateBidi(domain, 'ltr') })}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Simplify sub-section — Aggressive nested checkbox.
                  Rendered only when master AND the simplify sub-toggle are
                  both ON (ADHD-02 gate; same pattern as Auto-Suspend).
                  Aggressive applies ONLY to Options-shell
                  group rows per CONTEXT.md — the description below states
                  this explicitly. */}
              {meta.name === 'simplify' && simplifyActive && (
                <div className="mt-3 ms-3 ps-3 border-s-2 border-border space-y-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.simplify.aggressive}
                      onChange={(e) => handleSimplifyAggressive(e.target.checked)}
                      aria-label={t('settings.adhd.simplifyAggressiveAria')}
                      className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-1 focus:ring-primary cursor-pointer"
                    />
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t('settings.adhd.simplifyAggressiveTitle')}
                      </p>
                      <p className="text-caption text-muted-foreground mt-1 max-w-prose">
                        {t('settings.adhd.simplifyAggressiveDescription')}
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Visual Time sub-section — color-blind-safe palette toggle.
                  Rendered only when master AND the visualTime sub-toggle
                  are both ON (ADHD-02 gate; same pattern as sub-sections
                  above). The numeric minutes fallback is ADHD-30 and is
                  unconditional inside VisualTimeDisc itself — NOT exposed
                  as a setting here because it must never be optional. */}
              {meta.name === 'visualTime' && visualTimeActive && (
                <div className="mt-3 ms-3 ps-3 border-s-2 border-border space-y-3">
                  <p className="text-xs text-muted-foreground max-w-prose">
                    {t('settings.adhd.visualTimeDescription')}
                  </p>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.visualTime.colorBlindSafe}
                      onChange={(e) => handleVisualTimeColorBlindSafe(e.target.checked)}
                      aria-label={t('settings.adhd.colorBlindAria')}
                      className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-1 focus:ring-primary cursor-pointer"
                    />
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t('settings.adhd.colorBlindTitle')}
                      </p>
                      <p className="text-caption text-muted-foreground mt-1 max-w-prose">
                        {t('settings.adhd.colorBlindDescription')}
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Phase 12 — Flowtime Timer sub-section.
                  Coefficient slider (0.10–0.30, step 0.01) + live preview
                  using computeBreakMinutes (pure helper, importable by Settings).
                  Appears when master AND flowtimeTimer.enabled are both ON. */}
              {meta.name === 'flowtimeTimer' && flowtimeActive && (
                <div className="mt-3 ms-3 ps-3 border-s-2 border-border space-y-4">
                  {/* First-enable onboarding card */}
                  {flowtimeOnboardingVisible && (
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-500/20 bg-bg-0/70 text-blue-500 shadow-sm">
                          <Clock className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">{t('settings.adhd.flowtimeOnboardingTitle')}</p>
                              <p className="text-caption text-muted-foreground mt-1 max-w-prose">
                                {t('settings.adhd.flowtimeOnboardingDescription')}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleFlowtimeOnboardingDismiss}
                              className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                              aria-label={t('settings.adhd.dismissOnboarding')}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-3 text-blue-500">
                            <div className="min-w-[5.25rem]">
                              <div dir="ltr" className="text-lg font-semibold tabular-nums leading-none">12:34</div>
                              <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-blue-500/70">
                                {t('settings.adhd.flowtimeElapsed')}
                              </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-blue-500/60 rtl:rotate-180" />
                            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                              <Coffee className="h-3.5 w-3.5 text-blue-500" />
                              <span>{t('settings.adhd.flowtimeBreakSuggested')}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Coefficient slider */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label
                        className="text-xs font-medium text-foreground"
                        htmlFor="adhd-flowtime-coefficient"
                      >
                        {t('settings.adhd.breakRatio')}
                      </label>
                      <span dir="ltr" className="text-xs text-muted-foreground font-mono">
                        {flowtimeCoeff.toFixed(2)}
                      </span>
                    </div>
                    <input
                      id="adhd-flowtime-coefficient"
                      type="range"
                      dir="ltr"
                      min={FLOWTIME_COEFFICIENT_MIN}
                      max={FLOWTIME_COEFFICIENT_MAX}
                      step="0.01"
                      value={flowtimeCoeff}
                      onChange={(e) => handleFlowtimeCoefficientChange(Number(e.target.value))}
                      className="settings-range w-full"
                      aria-label={t('settings.adhd.breakRatioAria')}
                    />
                    {/* Live preview */}
                    <p dir="auto" className="text-caption text-muted-foreground mt-2 font-mono">
                      {t('settings.adhd.breakPreview', {
                        thirty: isolateBidi(flowtimePreview.thirty, 'ltr'),
                        sixty: isolateBidi(flowtimePreview.sixty, 'ltr'),
                        oneTwenty: isolateBidi(flowtimePreview.oneTwenty, 'ltr'),
                      })}
                    </p>
                    <p className="text-caption text-muted-foreground mt-1">
                      {t('settings.adhd.shorterThanFive')}
                    </p>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
                    <div className="min-w-0 pe-3">
                      <p className="text-sm font-medium text-foreground">{t('settings.adhd.autoFocusTitle')}</p>
                      <p className="text-caption text-muted-foreground mt-1 max-w-prose">
                        {t('settings.adhd.autoFocusDescription')}
                      </p>
                    </div>
                    <Switch
                      checked={settings.flowtimeTimer?.autoFocusEnabled ?? false}
                      onCheckedChange={handleFlowtimeAutoFocus}
                      aria-label={t('settings.adhd.autoFocusAria')}
                    />
                  </div>
                </div>
              )}

              {/* Phase 12 — Visible Tab Limit sub-section.
                  Limit slider (5–30, step 1, default 20). Pinned tabs are
                  always exempt (fixed rule, no toggle per CONTEXT.md).
                  Appears when master AND visibleTabLimit.enabled are both ON. */}
              {meta.name === 'visibleTabLimit' && vtlActive && (
                <div className="mt-3 ms-3 ps-3 border-s-2 border-border space-y-4">
                  {/* First-enable onboarding card */}
                  {vtlOnboardingVisible && (
                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-500/20 bg-bg-0/70 text-violet-400 shadow-sm">
                          <PanelTop className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">{t('settings.adhd.visibleTabLimitOnboardingTitle')}</p>
                              <p className="text-caption text-muted-foreground mt-1 max-w-prose">
                                {t('settings.adhd.visibleTabLimitOnboardingDescription')}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleVtlOnboardingDismiss}
                              className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                              aria-label={t('settings.adhd.dismissOnboarding')}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-bg-0/70 px-2.5 py-1 text-violet-300">
                              <PanelTop className="h-3.5 w-3.5" />
                              {t('settings.adhd.visibleTabsLabel', { count: 20 })}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 text-violet-400/70 rtl:rotate-180" />
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-0/70 px-2.5 py-1 text-muted-foreground">
                              {t('settings.adhd.foldIntoHidden')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Limit slider */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label
                        className="text-xs font-medium text-foreground"
                        htmlFor="adhd-vtl-limit"
                      >
                        {t('settings.adhd.visibleTabs')}
                      </label>
                      <span dir="ltr" className="text-xs text-muted-foreground font-mono">
                        {settings.visibleTabLimit?.limit ?? 20}
                      </span>
                    </div>
                    <input
                      id="adhd-vtl-limit"
                      type="range"
                      dir="ltr"
                      min={5}
                      max={30}
                      step={1}
                      value={settings.visibleTabLimit?.limit ?? 20}
                      onChange={(e) => handleVtlLimitChange(Number(e.target.value))}
                      className="settings-range w-full"
                      aria-label={t('settings.adhd.visibleTabsAria')}
                    />
                    <p className="text-caption text-muted-foreground mt-2">
                      {t('settings.adhd.pinnedAlwaysVisible')}
                    </p>
                    <p className="text-caption text-muted-foreground mt-1">
                      {t('settings.adhd.overflowMoveNote')}
                    </p>
                  </div>
                </div>
              )}

              {/* Phase 12 — Hard Focus sub-section.
                  Enable toggle (from SUB_TOGGLES) + domain-mode sub-toggle.
                  Appears when master AND hardFocus.enabled are both ON. */}
              {meta.name === 'hardFocus' && hardFocusActive && (
                <div className="mt-3 ms-3 ps-3 border-s-2 border-border space-y-3">
                  {/* First-enable onboarding card */}
                  {hardFocusOnboardingVisible && (
                    <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-orange-500/20 bg-bg-0/70 text-orange-500 shadow-sm">
                          <Lock className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">{t('settings.adhd.hardFocusOnboardingTitle')}</p>
                              <p className="text-caption text-muted-foreground mt-1 max-w-prose">
                                {t('settings.adhd.hardFocusOnboardingDescription')}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleHardFocusOnboardingDismiss}
                              className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                              aria-label={t('settings.adhd.dismissOnboarding')}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/20 bg-bg-0/70 px-2.5 py-1 text-orange-400">
                              <Lock className="h-3.5 w-3.5" />
                              {t('settings.adhd.snapshotLocked')}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 text-orange-500/60 rtl:rotate-180" />
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-0/70 px-2.5 py-1 text-muted-foreground">
                              <Globe2 className="h-3.5 w-3.5 text-orange-500" />
                              {t('settings.adhd.outsideLinksBlocked')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Domain-mode sub-toggle */}
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.hardFocus?.domainMode ?? false}
                      onChange={(e) => handleHardFocusDomainMode(e.target.checked)}
                      aria-label={t('settings.adhd.whitelistByDomainAria')}
                      className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-1 focus:ring-primary cursor-pointer"
                    />
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t('settings.adhd.whitelistByDomainTitle')}
                      </p>
                      <p className="text-caption text-muted-foreground mt-1 max-w-prose">
                        {t('settings.adhd.whitelistByDomainDescription')}
                      </p>
                    </div>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>

        {!master && (
          <p className="text-xs text-muted-foreground mt-2">
            {t('settings.adhd.enableFeaturesHint')}
          </p>
        )}

      </div>

      <AutoSuspendOnboardingDialog open={onboardingOpen} onClose={handleOnboardingClose} />
    </div>
  );
}
