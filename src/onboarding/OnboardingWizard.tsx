/**
 * @module onboarding/OnboardingWizard
 *
 * WHY:  New users need guided setup to discover BlueTab's features. Without
 *       onboarding, users may not discover quick-save, group organization,
 *       or advanced features like Pomodoro and Focus Mode.
 *
 * WHAT: Multi-step wizard with core steps for welcome, sidepanel,
 *       saving, Brain Dump, floating button access, organization, and done;
 *       plus an optional 5-step extended flow (Pomodoro, Focus, Reminders,
 *       Stats, Sync). Progress dots, forward/back navigation, and skip-at-any-step.
 *
 * HOW:  - framer-motion AnimatePresence for slide transitions between steps
 *       - Storage.set('onboarding_state', ...) on completion or skip
 *       - Redirects to options page after completing or skipping
 *       - Extended flow is opt-in from the Done step
 *
 * NOT:  Does not manage routing — this is a standalone page with no React Router.
 *       Does not re-open if onboarding_state.completed is already true.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Save,
  FolderOpen,
  Brain,
  AppWindow,
  CheckCircle,
  Timer,
  Shield,
  Bell,
  BarChart2,
  Cloud,
  ArrowRight,
  ArrowLeft,
  X,
  ChevronRight,
  MousePointerClick,
} from 'lucide-react';
import { Storage } from '@/utils/storage';
import { ThemeManager, type Theme } from '@/utils/theme';
import {
  hasFloatingButtonHostAccess,
  requestFloatingButtonHostAccess,
} from '@/services/floating-button-content-script';
import {
  applyLanguagePreference,
  getLanguageDirection,
  setDocumentTitle,
  type LanguagePreference,
} from '@/i18n';
import type { LucideIcon } from 'lucide-react';
import type { Settings } from '@/types/models';
import bluetabAvatar from '@/assets/bluetab-avatar.png';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Step {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  content: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Step content components
// ---------------------------------------------------------------------------

function ThemeOption({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background/70 text-foreground hover:bg-accent'
      }`}
    >
      {label}
    </button>
  );
}

function WelcomeContent({
  theme,
  onThemeChange,
  language,
  onLanguageChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  language: LanguagePreference;
  onLanguageChange: (language: LanguagePreference) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          {t('onboarding.welcome.introLine1')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('onboarding.welcome.introLine2')}
        </p>
      </div>
      <div className="w-full rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-foreground">{t('onboarding.welcome.languageTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('onboarding.welcome.languageDescription')}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ThemeOption active={language === 'system'} label={t('common.browserDefault')} onClick={() => onLanguageChange('system')} />
          <ThemeOption active={language === 'en'} label={t('common.english')} onClick={() => onLanguageChange('en')} />
          <ThemeOption active={language === 'tr'} label={t('common.turkish')} onClick={() => onLanguageChange('tr')} />
          <ThemeOption active={language === 'es'} label={t('common.spanish')} onClick={() => onLanguageChange('es')} />
          <ThemeOption active={language === 'pt-BR'} label={t('common.brazilianPortuguese')} onClick={() => onLanguageChange('pt-BR')} />
          <ThemeOption active={language === 'id'} label={t('common.indonesian')} onClick={() => onLanguageChange('id')} />
          <ThemeOption active={language === 'ar'} label={t('common.arabic')} onClick={() => onLanguageChange('ar')} />
        </div>
      </div>
      <div className="w-full rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-foreground">{t('onboarding.welcome.themeTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('onboarding.welcome.themeDescription')}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ThemeOption active={theme === 'system'} label={t('common.browser')} onClick={() => onThemeChange('system')} />
          <ThemeOption active={theme === 'light'} label={t('common.light')} onClick={() => onThemeChange('light')} />
          <ThemeOption active={theme === 'dark'} label={t('common.dark')} onClick={() => onThemeChange('dark')} />
        </div>
      </div>
    </div>
  );
}

function FloatingButtonAccessContent({
  floatingButtonAccessGranted,
  floatingButtonAccessLoading,
  onEnableFloatingButtonAccess,
}: {
  floatingButtonAccessGranted: boolean;
  floatingButtonAccessLoading: boolean;
  onEnableFloatingButtonAccess: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="w-full rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">{t('onboarding.floatingButton.cardTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {t('onboarding.floatingButton.cardBody')}
          </p>
        </div>
        {floatingButtonAccessGranted ? (
          <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-600 dark:text-green-400 text-center">
            {t('onboarding.floatingButton.enabled')}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onEnableFloatingButtonAccess}
              disabled={floatingButtonAccessLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              {floatingButtonAccessLoading ? t('onboarding.floatingButton.requesting') : t('onboarding.floatingButton.enableCta')}
            </button>
            <span className="text-xs text-muted-foreground">
              {t('onboarding.floatingButton.laterHint')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SaveContent() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="w-full rounded-xl border border-border bg-muted/30 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('onboarding.save.label')}</p>
        <p className="text-sm text-muted-foreground">
          {t('onboarding.save.body')}
        </p>
      </div>
    </div>
  );
}

function BrainDumpContent() {
  const { t } = useTranslation();
  const shortcutCopy = t('onboarding.brainDump.shortcut');
  const [beforeShortcut, afterShortcut = ''] = shortcutCopy.split('Alt+Q');

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="w-full rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('onboarding.brainDump.body')}
        </p>
        <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-sm text-foreground">
          {beforeShortcut}<bdi dir="ltr">Alt+Q</bdi>{afterShortcut}
        </div>
      </div>
      <div className="w-full rounded-xl border border-border bg-muted/30 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {t('onboarding.brainDump.goodFor')}
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            {t('onboarding.brainDump.goodForIdea')}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            {t('onboarding.brainDump.goodForInbox')}
          </li>
        </ul>
      </div>
    </div>
  );
}

function OrganizeContent() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 mt-2 rounded-full bg-primary shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('onboarding.organize.groupsTitle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('onboarding.organize.groupsBody')}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 mt-2 rounded-full bg-blue-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('onboarding.organize.projectsTitle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('onboarding.organize.projectsBody')}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 mt-2 rounded-full bg-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('onboarding.organize.restoreTitle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('onboarding.organize.restoreBody')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidepanelContent() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t('onboarding.sidepanel.pinTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {t('onboarding.sidepanel.pinDescription')}
          </p>
        </div>
        <div className="rounded-lg border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
          {t('onboarding.sidepanel.pinHint')}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('onboarding.sidepanel.usesTitle')}</p>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            {t('onboarding.sidepanel.usesTabs')}
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            {t('onboarding.sidepanel.usesTools')}
          </div>
        </div>
      </div>
    </div>
  );
}

function DoneContent({
  onShowExtended,
  showExtended,
}: {
  onShowExtended: () => void;
  showExtended: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          {t('onboarding.done.body')}
        </p>
        {!showExtended && (
          <button
            onClick={onShowExtended}
            className="inline-flex items-center gap-1.5 mt-2 text-sm text-primary hover:underline font-medium"
          >
            {t('onboarding.done.exploreAdvanced')} <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </button>
        )}
        {showExtended && (
          <p className="text-xs text-muted-foreground mt-1">
            {t('onboarding.done.extendedHint')}
          </p>
        )}
      </div>
    </div>
  );
}

function InfoContent({
  items,
  badge,
}: {
  items: string[];
  badge?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {badge ? (
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {badge}
        </span>
      ) : null}
      <ul className="w-full space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

function buildCoreSteps(
  t: (key: string, options?: Record<string, unknown>) => string,
  showExtended: boolean,
  onShowExtended: () => void,
  floatingButtonAccessGranted: boolean,
  floatingButtonAccessLoading: boolean,
  onEnableFloatingButtonAccess: () => void,
  theme: Theme,
  onThemeChange: (theme: Theme) => void,
  language: LanguagePreference,
  onLanguageChange: (language: LanguagePreference) => void,
): Step[] {
  return [
    {
      id: 'welcome',
      title: t('onboarding.welcome.title'),
      description: t('onboarding.welcome.description'),
      icon: Sparkles,
      content: (
        <WelcomeContent
          theme={theme}
          onThemeChange={onThemeChange}
          language={language}
          onLanguageChange={onLanguageChange}
        />
      ),
    },
    {
      id: 'sidepanel',
      title: t('onboarding.sidepanel.title'),
      description: t('onboarding.sidepanel.description'),
      icon: AppWindow,
      content: <SidepanelContent />,
    },
    {
      id: 'save',
      title: t('onboarding.save.title'),
      description: t('onboarding.save.description'),
      icon: Save,
      content: <SaveContent />,
    },
    {
      id: 'brain-dump',
      title: 'Brain Dump',
      description: t('onboarding.brainDump.description'),
      icon: Brain,
      content: <BrainDumpContent />,
    },
    {
      id: 'floating-button',
      title: t('onboarding.floatingButton.title'),
      description: t('onboarding.floatingButton.description'),
      icon: MousePointerClick,
      content: (
        <FloatingButtonAccessContent
          floatingButtonAccessGranted={floatingButtonAccessGranted}
          floatingButtonAccessLoading={floatingButtonAccessLoading}
          onEnableFloatingButtonAccess={onEnableFloatingButtonAccess}
        />
      ),
    },
    {
      id: 'organize',
      title: t('onboarding.organize.title'),
      description: t('onboarding.organize.description'),
      icon: FolderOpen,
      content: <OrganizeContent />,
    },
    {
      id: 'done',
      title: t('onboarding.done.title'),
      description: t('onboarding.done.description'),
      icon: CheckCircle,
      content: <DoneContent onShowExtended={onShowExtended} showExtended={showExtended} />,
    },
  ];
}

function buildExtendedSteps(
  t: (key: string, options?: Record<string, unknown>) => string,
): Step[] {
  return [
    {
      id: 'pomodoro',
      title: t('onboarding.extended.pomodoro.title'),
      description: t('onboarding.extended.pomodoro.description'),
      icon: Timer,
      content: (
        <InfoContent
          items={[
            t('onboarding.extended.pomodoro.item1'),
            t('onboarding.extended.pomodoro.item2'),
            t('onboarding.extended.pomodoro.item3'),
            t('onboarding.extended.pomodoro.item4'),
          ]}
        />
      ),
    },
    {
      id: 'focus',
      title: t('onboarding.extended.focus.title'),
      description: t('onboarding.extended.focus.description'),
      icon: Shield,
      content: (
        <InfoContent
          items={[
            t('onboarding.extended.focus.item1'),
            t('onboarding.extended.focus.item2'),
            t('onboarding.extended.focus.item3'),
            t('onboarding.extended.focus.item4'),
          ]}
        />
      ),
    },
    {
      id: 'reminders',
      title: t('onboarding.extended.reminders.title'),
      description: t('onboarding.extended.reminders.description'),
      icon: Bell,
      content: (
        <InfoContent
          items={[
            t('onboarding.extended.reminders.item1'),
            t('onboarding.extended.reminders.item2'),
            t('onboarding.extended.reminders.item3'),
            t('onboarding.extended.reminders.item4'),
          ]}
        />
      ),
    },
    {
      id: 'stats',
      title: t('onboarding.extended.stats.title'),
      description: t('onboarding.extended.stats.description'),
      icon: BarChart2,
      content: (
        <InfoContent
          items={[
            t('onboarding.extended.stats.item1'),
            t('onboarding.extended.stats.item2'),
            t('onboarding.extended.stats.item3'),
            t('onboarding.extended.stats.item4'),
          ]}
        />
      ),
    },
    {
      id: 'sync',
      title: t('onboarding.extended.sync.title'),
      description: t('onboarding.extended.sync.description'),
      icon: Cloud,
      content: (
        <InfoContent
          badge={t('onboarding.extended.sync.badge')}
          items={[
            t('onboarding.extended.sync.item1'),
            t('onboarding.extended.sync.item2'),
            t('onboarding.extended.sync.item3'),
            t('onboarding.extended.sync.item4'),
          ]}
        />
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export function OnboardingWizard() {
  const { t, i18n } = useTranslation();
  const isRtl = getLanguageDirection(i18n.resolvedLanguage ?? i18n.language) === 'rtl';
  const translateStep = useCallback(
    (key: string, options?: Record<string, unknown>) => t(key as never, options as never) as unknown as string,
    [t],
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [showExtended, setShowExtended] = useState(false);
  const [floatingButtonAccessGranted, setFloatingButtonAccessGranted] = useState(false);
  const [floatingButtonAccessLoading, setFloatingButtonAccessLoading] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [language, setLanguage] = useState<LanguagePreference>('system');

  const refreshFloatingButtonAccess = useCallback(async () => {
    const granted = await hasFloatingButtonHostAccess();
    setFloatingButtonAccessGranted(granted);
  }, []);

  useEffect(() => {
    void refreshFloatingButtonAccess();
  }, [refreshFloatingButtonAccess]);

  useEffect(() => {
    ThemeManager.getCurrentTheme().then(setTheme).catch(() => {});
    Storage.get<Settings>('settings').then((storedSettings) => {
      const nextLanguage = storedSettings?.language;
      if (
        nextLanguage === 'system'
        || nextLanguage === 'en'
        || nextLanguage === 'tr'
        || nextLanguage === 'es'
        || nextLanguage === 'pt-BR'
        || nextLanguage === 'id'
        || nextLanguage === 'ar'
      ) {
        setLanguage(nextLanguage);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setDocumentTitle('document.onboardingTitle');
  }, [i18n.language]);

  const handleEnableFloatingButtonAccess = useCallback(async () => {
    setFloatingButtonAccessLoading(true);
    try {
      const granted = await requestFloatingButtonHostAccess();
      setFloatingButtonAccessGranted(granted);

      if (granted) {
        await chrome.runtime.sendMessage({ type: 'FLOATING_BUTTON_SYNC_CONTENT_SCRIPT' }).catch(() => {});
      }
    } finally {
      setFloatingButtonAccessLoading(false);
    }
  }, []);

  const handleShowExtended = () => {
    setShowExtended(true);
  };

  const handleThemeChange = useCallback(async (nextTheme: Theme) => {
    setTheme(nextTheme);
    ThemeManager.applyTheme(nextTheme);

    try {
      const currentSettings = (await Storage.get<Settings>('settings')) ?? ({} as Settings);
      await Storage.set('settings', { ...currentSettings, theme: nextTheme });
    } catch (err) {
      console.debug('[BlueTab][Onboarding] theme update error', err);
    }
  }, []);

  const handleLanguageChange = useCallback(async (nextLanguage: LanguagePreference) => {
    setLanguage(nextLanguage);

    try {
      const currentSettings = (await Storage.get<Settings>('settings')) ?? ({} as Settings);
      await Storage.set('settings', { ...currentSettings, language: nextLanguage });
      await applyLanguagePreference(nextLanguage);
      setDocumentTitle('document.onboardingTitle');
    } catch (err) {
      console.debug('[BlueTab][Onboarding] language update error', err);
    }
  }, []);

  const coreSteps = buildCoreSteps(
    translateStep,
    showExtended,
    handleShowExtended,
    floatingButtonAccessGranted,
    floatingButtonAccessLoading,
    handleEnableFloatingButtonAccess,
    theme,
    handleThemeChange,
    language,
    handleLanguageChange,
  );
  const steps = showExtended ? [...coreSteps, ...buildExtendedSteps(translateStep)] : coreSteps;

  const isLastStep = currentStep === steps.length - 1;
  const isFirstStep = currentStep === 0;
  const isDoneStep = steps[currentStep].id === 'done';

  const navigateToOptions = () => {
    window.location.href = chrome.runtime.getURL('src/options/index.html');
  };

  const handleComplete = async () => {
    await Storage.set('onboarding_state', {
      completed: true,
      completedAt: Date.now(),
    });
    navigateToOptions();
  };

  const handleSkip = async () => {
    await Storage.set('onboarding_state', {
      completed: true,
      skippedAt: Date.now(),
    });
    navigateToOptions();
  };

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep((s) => Math.max(0, s - 1));
  };

  const step = steps[currentStep];
  const StepIcon = step.icon;
  const isWelcomeStep = step.id === 'welcome';
  const progressPercent = ((currentStep + 1) / steps.length) * 100;

  const nextLabel = isLastStep
    ? t('onboarding.finish')
    : isDoneStep && !showExtended
    ? t('onboarding.continue')
    : t('onboarding.next');

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-lg">
        {/* Card */}
        <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <span className="text-sm font-semibold text-primary">Bluetab</span>
            {!isLastStep && (
              <button
                onClick={handleSkip}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title={t('labels.skipOnboarding')}
              >
                <X className="w-3.5 h-3.5" />
                {t('onboarding.skip')}
              </button>
            )}
          </div>

          {/* Step content with animation */}
          <div className="px-6 pt-6 pb-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: isRtl ? -20 : 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: isRtl ? 20 : -20 }}
                transition={{ duration: 0.2 }}
              >
                {/* Step icon + heading */}
                <div className="flex flex-col items-center text-center mb-4">
                  {isWelcomeStep ? (
                    <img src={bluetabAvatar} alt="Bluetab" className="mb-3 h-14 w-14 rounded-2xl object-cover shadow-sm" />
                  ) : (
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-3">
                      <StepIcon className="w-6 h-6 text-primary" />
                    </div>
                  )}
                  <h1 className="text-2xl font-bold text-foreground">{step.title}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                </div>

                {/* Step-specific content */}
                <div>{step.content}</div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer: progress + navigation */}
          <div className="px-6 py-4 border-t border-border space-y-4">
            {/* Progress bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80">
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between gap-3">
              {/* Back button */}
              <button
                onClick={handleBack}
                disabled={isFirstStep}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isFirstStep
                    ? 'invisible'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                {t('onboarding.back')}
              </button>

              {/* Next / Finish button */}
              <button
                onClick={handleNext}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {nextLabel}
                {!isLastStep && <ArrowRight className="w-4 h-4 rtl:rotate-180" />}
              </button>
            </div>
          </div>
        </div>

        {/* Step counter */}
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {t('labels.stepCounter', { current: currentStep + 1, total: steps.length })}
        </p>
      </div>
    </div>
  );
}
