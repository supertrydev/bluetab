/**
 * @module sidepanel/components/TeamsPreSession
 *
 * WHY:  Before a session exists users need to either create (host) or join a
 *       live session. This is the entry-point UI for the Teams feature.
 *
 * WHAT: - "Host a Session" card: Pro-gated, "Start Session" button
 *       - "Join a Session" card: 6-char code input, auth-gated, "Join" button
 *       - Inline auto-dismiss error notifications on failure
 *
 * HOW:  - getFeatureGateUI on mount to check Pro status for host card
 *       - TeamsService.createSession() / joinSession() for actions
 *       - On success, TeamsService sets session state → TeamsPanel routes to SessionView
 *
 * NOT:  Does not own the TeamsService lifecycle — TeamsPanel does that.
 */

import { useState, useEffect, useRef } from 'react'
import { Users, UserPlus, Loader2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getFeatureGateUI, type FeatureGateUIData } from '@/utils/feature-gate'
import { TeamsService } from '@/services/teams-service'

function InlineError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
    const timerRef = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => {
        timerRef.current = setTimeout(onDismiss, 4000)
        return () => clearTimeout(timerRef.current)
    }, [onDismiss])

    return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs animate-in fade-in slide-in-from-top-1 duration-200">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span dir="auto" className="flex-1">{message}</span>
        </div>
    )
}

export function TeamsPreSession() {
    const { t } = useTranslation()
    const [gateData, setGateData] = useState<FeatureGateUIData | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [isJoining, setIsJoining] = useState(false)
    const [joinCode, setJoinCode] = useState('')
    const [error, setError] = useState<string | null>(null)

    const hostGateMessage = gateData?.reason === 'not_logged_in'
        ? t('sidepanel.teamsPreSession.signInToHost')
        : gateData?.reason === 'not_subscribed'
            ? t('sidepanel.teamsPreSession.upgradeToHost')
            : gateData?.reason === 'offline_expired'
                ? t('sidepanel.teamsPreSession.connectToHost')
                : t('sidepanel.teamsPreSession.premiumHost')

    const hostGateActionLabel = gateData?.reason === 'not_logged_in'
        ? t('auth.account.signIn')
        : t('auth.account.upgrade')

    useEffect(() => {
        getFeatureGateUI('team_sharing', 'Teams').then(setGateData).catch(() => {})
    }, [])

    const handleHost = async () => {
        setError(null)
        setIsCreating(true)
        try {
            const result = await TeamsService.createSession()
            if (!result.success) {
                setError(result.error ?? t('sidepanel.teamsPreSession.createFailed'))
            }
            // On success, TeamsService sets session state → TeamsPanel routes away
        } finally {
            setIsCreating(false)
        }
    }

    const handleJoin = async () => {
        const code = joinCode.trim().toUpperCase()
        if (code.length !== 6) {
            setError(t('sidepanel.teamsPreSession.invalidCode'))
            return
        }
        setError(null)
        setIsJoining(true)
        try {
            const result = await TeamsService.joinSession(code)
            if (!result.success) {
                setError(result.error ?? t('sidepanel.teamsPreSession.joinFailed'))
            }
            // On success TeamsPanel routes away via state change
        } finally {
            setIsJoining(false)
        }
    }

    return (
        <div className="flex flex-col gap-4 p-3">

            {/* Inline error notification */}
            {error && <InlineError message={error} onDismiss={() => setError(null)} />}

            {/* Host a Session card */}
            <div className="border border-border rounded-lg p-4 bg-card flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">{t('sidepanel.teamsPreSession.hostTitle')}</span>
                </div>

                {!gateData ? (
                    <div className="flex items-center justify-center py-2">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                ) : gateData.isAllowed ? (
                    <>
                        <p className="text-xs text-muted-foreground">
                            {t('sidepanel.teamsPreSession.hostDescription')}
                        </p>
                        <button
                            onClick={handleHost}
                            disabled={isCreating}
                            className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isCreating ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : null}
                            <span>{isCreating ? t('sidepanel.teamsPreSession.creating') : t('sidepanel.teamsPreSession.startSession')}</span>
                        </button>
                    </>
                ) : (
                    <>
                        <p className="text-xs text-muted-foreground">{hostGateMessage}</p>
                        <a
                            href={gateData.actionUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-center w-full px-3 py-2 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
                            onClick={(e) => {
                                e.preventDefault()
                                chrome.tabs.create({ url: gateData.actionUrl, active: true })
                            }}
                        >
                            {hostGateActionLabel}
                        </a>
                    </>
                )}
            </div>

            {/* Join a Session card */}
            <div className="border border-border rounded-lg p-4 bg-card flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">{t('sidepanel.teamsPreSession.joinTitle')}</span>
                </div>

                {gateData && !gateData.isAllowed && gateData.reason === 'not_logged_in' ? (
                    <>
                        <p className="text-xs text-muted-foreground">{t('sidepanel.teamsPreSession.signInToJoin')}</p>
                        <a
                            href={gateData.actionUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-center w-full px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
                            onClick={(e) => {
                                e.preventDefault()
                                chrome.tabs.create({ url: gateData.actionUrl, active: true })
                            }}
                        >
                            {t('sidepanel.teamsPreSession.signIn')}
                        </a>
                    </>
                ) : (
                    <>
                        <p className="text-xs text-muted-foreground">
                            {t('sidepanel.teamsPreSession.joinDescription')}
                        </p>
                        <input
                            type="text"
                            dir="ltr"
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                            placeholder={t('sidepanel.teamsPreSession.codePlaceholder')}
                            maxLength={6}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-center font-mono text-lg tracking-widest uppercase placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && joinCode.length === 6) {
                                    handleJoin()
                                }
                            }}
                        />
                        <button
                            onClick={handleJoin}
                            disabled={isJoining || joinCode.length !== 6}
                            className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isJoining ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : null}
                            <span>{isJoining ? t('sidepanel.teamsPreSession.joining') : t('sidepanel.teamsPreSession.join')}</span>
                        </button>
                    </>
                )}
            </div>

        </div>
    )
}
