/**
 * @module components/auth/UpgradeToProButton
 *
 * WHY:  Upgrade CTAs looked different on every screen (primary, outline,
 *       crown or star icons, "Upgrade to Pro PRO"). The MCP server section's
 *       outline button with the PRO badge is the reference design.
 *
 * WHAT: `UpgradeToProLabel` renders "Upgrade to [PRO]" where [PRO] is the
 *       ProBadge. Word order comes from the locale (`auth.account.upgradeToBadge`,
 *       `<badge/>` marks the badge position). `UpgradeToProButton` wraps it in
 *       the shared outline Button and opens the upgrade URL by default.
 *
 * NOT:  Does not check Pro status; callers decide when to render it.
 */

import { Trans } from 'react-i18next';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getUpgradeUrl } from '@/utils/feature-gate';
import { ProBadge } from './ProBadge';

export function UpgradeToProLabel({ className }: { className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1.5', className)}>
            <Trans i18nKey="auth.account.upgradeToBadge" components={{ badge: <ProBadge size="sm" /> }} />
        </span>
    );
}

export function UpgradeToProButton({ className, onClick, variant = 'outline', ...props }: ButtonProps) {
    return (
        <Button
            type="button"
            variant={variant}
            className={cn('gap-2', className)}
            onClick={(event) => {
                if (onClick) {
                    onClick(event);
                    return;
                }
                chrome.tabs.create({ url: getUpgradeUrl() });
            }}
            {...props}
        >
            <UpgradeToProLabel />
        </Button>
    );
}
