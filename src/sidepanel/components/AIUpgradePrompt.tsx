/**
 * @module sidepanel/components/AIUpgradePrompt
 *
 * WHY:  Non-Pro users who open the AI tab see this component instead of the
 *       chat interface. It demonstrates what the AI can do and provides a
 *       clear upgrade path to Pro.
 *
 * WHAT: Sidepanel-native locked AI state showing a calm chat preview and a
 *       single upgrade call-to-action.
 *
 * HOW:  Reads upgrade URL from getUpgradeUrl() in feature-gate.ts.
 *       Pure presentation — no state, no API calls.
 *
 * NOT:  Does not handle payment. Does not make API calls.
 */

import { Bot, LockKeyhole, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UpgradeToProButton } from '@/components/auth/UpgradeToProButton';
import { getUpgradeUrl } from '@/utils/feature-gate';

// ============================================================================
// Component
// ============================================================================

/** A single chat bubble hinting at what the assistant does. */
function LockedPreviewMessage() {
  const { t } = useTranslation();

  return (
    <div className="flex w-full items-start gap-2 text-left">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-bg-1 px-3 py-2.5">
        <p className="text-[11px] font-semibold text-text-strong">
          {t('sidepanel.aiUpgradePrompt.assistantName')}
        </p>
        <p className="mt-0.5 text-caption leading-relaxed text-text">
          {t('sidepanel.aiUpgradePrompt.preview')}
        </p>
      </div>
    </div>
  );
}

export function AIUpgradePrompt() {
  const { t } = useTranslation();
  const upgradeUrl = getUpgradeUrl();
  const openUpgrade = () => {
    chrome.tabs.create({ url: upgradeUrl });
  };

  return (
    <div className="relative h-full overflow-hidden bg-bg-0">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_50%_20%,hsla(226,68%,50%,0.16),transparent_65%)]" />

      <div className="relative flex h-full flex-col px-4 py-4">
        {/* Centered intro: icon, title, one preview bubble */}
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-muted text-primary shadow-lg shadow-primary/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="mt-4 text-base font-semibold text-text-strong">
            {t('sidepanel.aiUpgradePrompt.title')}
          </p>
          <p className="mt-1 text-caption text-text-muted">
            {t('sidepanel.aiUpgradePrompt.subtitle')}
          </p>

          <div className="mt-6 w-full max-w-xs">
            <LockedPreviewMessage />
          </div>
        </div>

        {/* Locked composer + single CTA */}
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={openUpgrade}
            aria-label={t('sidepanel.aiUpgradePrompt.upgrade')}
            className="flex min-h-10 w-full items-center justify-between gap-2 rounded-full border border-border/70 bg-bg-1/60 px-4 text-xs text-text-muted transition-colors hover:border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="truncate">{t('sidepanel.aiUpgradePrompt.inputPlaceholder')}</span>
            <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
          </button>

          <UpgradeToProButton className="w-full" onClick={openUpgrade} />
        </div>
      </div>
    </div>
  );
}
