/**
 * @module components/auth/AccountSection
 *
 * WHY: Display account status in settings page.
 *
 * WHAT: Shows login state, user info, subscription status, and actions.
 *
 * HOW: Uses useAuth hook and provides login/logout functionality.
 */

import { useState } from 'react'
import { Button } from '../ui/button'
import { useAuth } from './useAuth'
import { LoginModal } from './LoginModal'
import { ProBadge } from './ProBadge'
import { UpgradeToProButton } from './UpgradeToProButton'
import { config } from '../../config/config'
import { getLocaleTag } from '@/i18n'
import { isolateBidi } from '@/i18n/bidi'
import {
    User,
    LogOut,
    LogIn,
    CircleStar,
    RefreshCw,
    ExternalLink,
    Mail,
    Calendar,
    AlertCircle,
    Cloud,
    Sparkles,
    Zap,
    Plug2,
    Link2,
    Server,
} from 'lucide-react'
import { BluetConnectionSection } from '../bluet/BluetConnectionSection'
import { useTranslation } from 'react-i18next'

const PRO_FEATURES = [
    {
        icon: Cloud,
        titleKey: 'auth.account.proFeatures.cloudSync.title',
        descriptionKey: 'auth.account.proFeatures.cloudSync.description',
    },
    {
        icon: Sparkles,
        titleKey: 'auth.account.proFeatures.ai.title',
        descriptionKey: 'auth.account.proFeatures.ai.description',
    },
    {
        icon: Zap,
        titleKey: 'auth.account.proFeatures.automations.title',
        descriptionKey: 'auth.account.proFeatures.automations.description',
    },
    {
        icon: Plug2,
        titleKey: 'auth.account.proFeatures.tools.title',
        descriptionKey: 'auth.account.proFeatures.tools.description',
    },
    {
        icon: Link2,
        titleKey: 'auth.account.proFeatures.bluet.title',
        descriptionKey: 'auth.account.proFeatures.bluet.description',
    },
    {
        icon: Server,
        titleKey: 'auth.account.proFeatures.mcp.title',
        descriptionKey: 'auth.account.proFeatures.mcp.description',
    },
] as const

export function AccountSection() {
    const { t } = useTranslation()
    const { isLoggedIn, isLoading, user, subscription, isPro, logout, refresh } = useAuth()
    const [showLoginModal, setShowLoginModal] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)

    const handleRefresh = async () => {
        setIsRefreshing(true)
        await refresh()
        setIsRefreshing(false)
    }

    const handleManageSubscription = () => {
        chrome.tabs.create({ url: `${config.supertry.baseUrl}/dashboard` })
    }

    const handleUpgrade = () => {
        chrome.tabs.create({ url: `${config.supertry.baseUrl}/dashboard?upgrade=bluetab-pro` })
    }

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return null
        return new Date(dateStr).toLocaleDateString(getLocaleTag(), {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        })
    }

    return (
        <div className="space-y-6">
            {/* Section Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary-muted">
                    <User className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-text-strong">{t('auth.account.title')}</h3>
            </div>

            {/* Main Account Card */}
            <div className="rounded-lg bg-bg-1 border border-border overflow-hidden">
                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <RefreshCw className="h-6 w-6 animate-spin text-text-muted" />
                    </div>
                ) : isLoggedIn && user ? (
                    <div className="divide-y divide-border">
                        {/* User Profile Section */}
                        <div className="p-5">
                            <div className="flex items-center gap-4">
                                {/* Avatar */}
                                <div className="relative">
                                    <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white text-xl font-semibold shadow-md">
                                        {user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                                    </div>
                                    {isPro && (
                                        <div className="absolute -bottom-1 -end-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow-sm">
                                            <CircleStar className="h-3.5 w-3.5 text-white" />
                                        </div>
                                    )}
                                </div>

                                {/* User Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-text-strong text-lg truncate">
                                            <bdi dir="auto">{user.name || t('auth.account.defaultUser')}</bdi>
                                        </span>
                                        {isPro && <ProBadge size="sm" />}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-sm text-text-muted mt-0.5">
                                        <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="truncate"><bdi dir="ltr">{user.email}</bdi></span>
                                    </div>
                                </div>

                                {/* Refresh Button */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleRefresh}
                                    disabled={isRefreshing}
                                    className="text-text-muted hover:text-text-strong hover:bg-accent flex-shrink-0"
                                >
                                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                </Button>
                            </div>
                        </div>

                        {/* Subscription Status Section */}
                        <div className="p-5">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-md ${isPro ? 'bg-primary/15' : 'bg-bg-2'}`}>
                                            <CircleStar className={`h-4 w-4 ${isPro ? 'text-primary' : 'text-text-muted'}`} />
                                        </div>
                                        <span className="font-medium text-text-strong">
                                            {isPro ? t('auth.account.proPlan') : t('auth.account.freePlan')}
                                        </span>
                                    </div>
                                    {subscription?.expiresAt && (
                                        <div className="flex items-center gap-1.5 text-xs text-text-muted ms-8">
                                            <Calendar className="h-3 w-3" />
                                            <span dir="auto">
                                                {subscription.cancelAtPeriodEnd ? t('auth.account.expires') : t('auth.account.renews')}: {isolateBidi(formatDate(subscription.expiresAt) ?? '', 'ltr')}
                                            </span>
                                        </div>
                                    )}
                                    {subscription?.cancelAtPeriodEnd && (
                                        <div className="flex items-center gap-1.5 text-xs text-danger ms-8">
                                            <AlertCircle className="h-3 w-3" />
                                            <span>{t('auth.account.subscriptionWillNotRenew')}</span>
                                        </div>
                                    )}
                                </div>
                                {isPro ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleManageSubscription}
                                        className="border-border text-text hover:bg-accent hover:text-text-strong"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        {t('auth.account.manage')}
                                    </Button>
                                ) : (
                                    <Button
                                        size="sm"
                                        onClick={handleUpgrade}
                                        className=""
                                    >
                                        <CircleStar className="h-3.5 w-3.5" />
                                        {t('auth.account.upgrade')}
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Sign Out Section */}
                        <div className="px-5 py-3 bg-bg-0/50">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={logout}
                                className="text-danger hover:text-danger hover:bg-danger-muted"
                            >
                                <LogOut className="h-4 w-4" />
                                {t('auth.account.signOut')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* Logged Out State */
                    <div className="p-8 text-center">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                            <User className="h-8 w-8 text-text-muted" />
                        </div>
                        <h4 className="text-text-strong font-semibold text-lg mb-1">{t('auth.account.notSignedIn')}</h4>
                        <p className="text-sm text-text-muted mb-6 max-w-xs mx-auto">
                            {t('auth.account.notSignedInDescription')}
                        </p>
                        <Button
                            onClick={() => setShowLoginModal(true)}
                            className=""
                        >
                            <LogIn className="h-4 w-4" />
                            {t('auth.account.signIn')}
                        </Button>
                    </div>
                )}
            </div>

            {/* Premium Features Card - Only show when not Pro */}
            {!isPro && (
                <div className="rounded-lg overflow-hidden border border-border bg-bg-1">
                    {/* Header */}
                    <div className="px-5 py-4 border-b border-border">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md bg-primary/15">
                                <CircleStar className="h-5 w-5 text-primary" />
                            </div>
                            <span className="font-semibold text-text-strong">{t('auth.account.proPlan')}</span>
                        </div>
                    </div>

                    {/* Features Grid */}
                    <div className="p-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {PRO_FEATURES.map(({ icon, titleKey, descriptionKey }) => (
                                <FeatureItem
                                    key={titleKey}
                                    icon={icon}
                                    title={t(titleKey)}
                                    description={t(descriptionKey)}
                                />
                            ))}
                        </div>

                        <UpgradeToProButton
                            onClick={handleUpgrade}
                            className="w-full mt-5"
                        />
                    </div>
                </div>
            )}

            {/* Bluet Connection - only show when logged in */}
            {isLoggedIn && (
                <BluetConnectionSection />
            )}

            <LoginModal
                isOpen={showLoginModal}
                onClose={() => setShowLoginModal(false)}
            />
        </div>
    )
}

function FeatureItem({
    icon: Icon,
    title,
    description,
}: {
    icon: React.ElementType
    title: string
    description: string
}) {
    return (
        <div className="flex items-start gap-3 p-4 rounded-md bg-muted">
            <div className="p-1 rounded bg-primary/10 mt-0.5 flex-shrink-0">
                <Icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium leading-5 text-text-strong">{title}</p>
                <p className="text-xs leading-4 text-text-muted">{description}</p>
            </div>
        </div>
    )
}
