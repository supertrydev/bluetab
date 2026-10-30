/**
 * @module components/ZzIcon
 *
 * WHY:  Phase 9 Safe Auto-Suspend ships "Zz" as the ONE symbol for the
 *       suspended state across every surface: Chrome's tab-strip favicon
 *       (src/content/favicon-overlay.ts), the toolbar action badge
 *       (chrome.action.setBadgeText('Zz') in auto-suspend-service), and
 *       the sidepanel discarded-tab indicator (this icon). A previous
 *       iteration used lucide-react's OctagonPause in the sidepanel —
 *       visually distinct from the favicon Zz, which read as a different
 *       state to users and broke the object-permanence mental model
 *       (CRIT-04). Unifying to a shared Zz glyph keeps the signal
 *       consistent.
 *
 * HOW:  Small inline SVG React component. Two overlapping "Z" glyphs
 *       laid out like the favicon Zz so the sidepanel row, the favicon,
 *       and the toolbar badge all carry the same symbol.
 *
 * NOT:  - Does not ship a container — callers choose background /
 *         positioning (e.g. TabItem wraps it in a tiny chip at the
 *         bottom-right of the favicon).
 *       - Does not animate — the suspended state is persistent; motion
 *         would distract.
 */

import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';

export interface ZzIconProps extends SVGProps<SVGSVGElement> {
  /**
   * Tailwind class(es) for sizing. Defaults match the other inline icons
   * used in TabItem (w-3 h-3) — the old OctagonPause slot. Callers can
   * override for larger surfaces.
   */
  className?: string;
}

export function ZzIcon({
  className,
  ...rest
}: ZzIconProps): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('w-3 h-3', className)}
      {...rest}
    >
      {/* Two overlapping Zs — back Z is larger/fainter, front Z on top.
          Stroke-only so the icon inherits currentColor like other Lucide
          icons in use throughout the sidepanel. */}
      <path
        d="M3 4h5L3 10h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M8 7h5l-5 5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
