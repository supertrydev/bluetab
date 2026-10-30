/**
 * @module settings/components/AutoSuspendOnboardingDialog
 *
 * WHY:  Phase 9 ADHD-09 — object-permanence mental-model priming. The first
 *       time a user enables Safe Auto-Suspend we show a dialog that
 *       explicitly differentiates "suspend" from "close" with a short
 *       visual demo. Without this, users who see their first Zz-favicon
 *       tab can misread it as "the tab broke" and panic (CRIT-04).
 *
 * WHAT: Radix Dialog with:
 *       - Title "Safe Auto-Suspend"
 *       - Short English paragraph explaining the suspend-vs-close invariant
 *       - Inline animated SVG demo (tab pales → Zz → click → restore)
 *       - "Got it" button that dismisses and sets
 *         autoSuspend.onboardingSeen = true so we never show it again
 *
 * HOW:  - prefers-reduced-motion honored via a CSS class that disables
 *         the SVG keyframe animations (ADHD-18). Static first frame only
 *         when the user has the OS-level setting on.
 *       - No external assets; inline SVG + inline <style> block keep the
 *         component self-contained so the dialog ships without touching
 *         tailwind.css or any shared stylesheet.
 *
 * NOT:  Does not read chrome.storage directly — ADHDService.updateSettings
 *       is the single write path for onboardingSeen.
 *       Does not manage its own open state — parent (ADHDSettings) owns it.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Inline SVG showing three tabs. The middle tab fades out to 50% opacity,
 * a Zz badge appears, then a click indicator flashes and the tab fades
 * back to full opacity — the whole cycle loops every 4 seconds.
 *
 * prefers-reduced-motion disables the keyframes entirely; the first-frame
 * static render is all three tabs at full opacity (no Zz, no click), which
 * is the calmest "nothing has changed yet" state and matches ADHD-18.
 */
function OnboardingDemoSvg() {
  const { t } = useTranslation();
  const styles = `
    @keyframes bluetab-as-pale {
      0% { opacity: 1; }
      25% { opacity: 1; }
      50% { opacity: 0.55; }
      85% { opacity: 0.55; }
      100% { opacity: 1; }
    }
    @keyframes bluetab-as-zz {
      0% { opacity: 0; }
      40% { opacity: 0; }
      50% { opacity: 1; }
      85% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes bluetab-as-click {
      0% { opacity: 0; transform: scale(0.5); }
      70% { opacity: 0; transform: scale(0.5); }
      80% { opacity: 1; transform: scale(1.2); }
      100% { opacity: 0; transform: scale(1); }
    }
    .bluetab-as-demo .bluetab-as-tab-middle {
      animation: bluetab-as-pale 4s ease-in-out infinite;
    }
    .bluetab-as-demo .bluetab-as-zz {
      animation: bluetab-as-zz 4s ease-in-out infinite;
    }
    .bluetab-as-demo .bluetab-as-click {
      animation: bluetab-as-click 4s ease-in-out infinite;
      transform-origin: 160px 80px;
    }
    @media (prefers-reduced-motion: reduce) {
      .bluetab-as-demo .bluetab-as-tab-middle,
      .bluetab-as-demo .bluetab-as-zz,
      .bluetab-as-demo .bluetab-as-click {
        animation: none;
      }
      .bluetab-as-demo .bluetab-as-zz {
        opacity: 0;
      }
      .bluetab-as-demo .bluetab-as-click {
        opacity: 0;
      }
    }
  `;

  return (
    <div className="bluetab-as-demo w-full rounded-lg border border-border bg-bg-1/50 p-4">
      <style>{styles}</style>
      <svg
        viewBox="0 0 320 120"
        className="w-full h-auto"
        role="img"
        aria-label={t('settings.autoSuspendOnboarding.demoAria')}
      >
        {/* Three tab rects, middle one is the one that "sleeps" */}
        <g>
          {/* Left tab — static */}
          <rect x="20" y="40" width="80" height="40" rx="6" fill="#3b82f6" opacity="0.85" />
          <rect x="30" y="52" width="14" height="14" rx="2" fill="#ffffff" opacity="0.7" />
          <rect x="50" y="54" width="40" height="4" rx="2" fill="#ffffff" opacity="0.6" />
          <rect x="50" y="62" width="30" height="4" rx="2" fill="#ffffff" opacity="0.4" />

          {/* Middle tab — fades to pale */}
          <g className="bluetab-as-tab-middle">
            <rect x="120" y="40" width="80" height="40" rx="6" fill="#3b82f6" />
            <rect x="130" y="52" width="14" height="14" rx="2" fill="#ffffff" opacity="0.8" />
            <rect x="150" y="54" width="40" height="4" rx="2" fill="#ffffff" opacity="0.7" />
            <rect x="150" y="62" width="30" height="4" rx="2" fill="#ffffff" opacity="0.5" />
          </g>

          {/* Zz glyph that appears on the middle tab */}
          <g className="bluetab-as-zz">
            <circle cx="190" cy="50" r="10" fill="#64748b" />
            <text
              x="190"
              y="54"
              fontFamily="sans-serif"
              fontSize="11"
              fontWeight="bold"
              textAnchor="middle"
              fill="#ffffff"
            >
              Zz
            </text>
          </g>

          {/* Click indicator — centered on the middle tab */}
          <g className="bluetab-as-click">
            <circle cx="160" cy="60" r="16" fill="none" stroke="#3b82f6" strokeWidth="3" />
          </g>

          {/* Right tab — static */}
          <rect x="220" y="40" width="80" height="40" rx="6" fill="#3b82f6" opacity="0.85" />
          <rect x="230" y="52" width="14" height="14" rx="2" fill="#ffffff" opacity="0.7" />
          <rect x="250" y="54" width="40" height="4" rx="2" fill="#ffffff" opacity="0.6" />
          <rect x="250" y="62" width="30" height="4" rx="2" fill="#ffffff" opacity="0.4" />
        </g>
      </svg>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {t('settings.autoSuspendOnboarding.demoCaption')}
      </p>
    </div>
  );
}

export function AutoSuspendOnboardingDialog({ open, onClose }: Props) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border pe-12">
          <DialogTitle>{t('settings.autoSuspendOnboarding.title')}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t('settings.autoSuspendOnboarding.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          <OnboardingDemoSvg />
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border bg-transparent">
          <Button onClick={onClose} variant="primary">
            {t('settings.autoSuspendOnboarding.gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
