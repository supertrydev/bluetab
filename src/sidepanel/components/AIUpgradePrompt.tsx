/**
 * @module sidepanel/components/AIUpgradePrompt
 *
 * WHY:  Non-Pro users who open the AI tab see this component instead of the
 *       chat interface.
 *
 * WHAT: The Bluetab mark, one message saying what the assistant does, and a
 *       single upgrade button.
 *
 * HOW:  Reads upgrade URL from getUpgradeUrl() in feature-gate.ts.
 *       Pure presentation — no state, no API calls.
 *
 * NOT:  Does not handle payment. Does not make API calls.
 */

import { useTranslation } from 'react-i18next';
import { UpgradeToProButton } from '@/components/auth/UpgradeToProButton';
import { getUpgradeUrl } from '@/utils/feature-gate';
import bluetabAvatar from '@/assets/bluetab-avatar.png';

/** A single chat bubble hinting at what the assistant does. */
function LockedPreviewMessage() {
  const { t } = useTranslation();

  return (
    <p className="rounded-2xl border border-border bg-bg-1 px-4 py-3 text-start text-sm leading-relaxed text-text">
      {t('sidepanel.aiUpgradePrompt.preview')}
    </p>
  );
}

export function AIUpgradePrompt() {
  const { t } = useTranslation();
  const upgradeUrl = getUpgradeUrl();
  const openUpgrade = () => {
    chrome.tabs.create({ url: upgradeUrl });
  };

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto bg-bg-0 px-4 py-6">
      <div className="flex w-full max-w-xs flex-col items-center">
        <img src={bluetabAvatar} alt="" width={56} height={56} className="h-14 w-14 rounded-2xl" />
        <h2 className="mt-3 text-base font-semibold text-text-strong">
          {t('sidepanel.aiUpgradePrompt.title')}
        </h2>
        <div className="mt-5 w-full">
          <LockedPreviewMessage />
        </div>
        <UpgradeToProButton
          className="mt-4 w-full"
          onClick={openUpgrade}
          aria-label={t('sidepanel.aiUpgradePrompt.upgrade')}
        />
      </div>
    </div>
  );
}
