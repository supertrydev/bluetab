/**
 * @module sidepanel/components/TeamsCodeDisplay
 *
 * WHY:  After creating a session the host needs a prominent, easy-to-share
 *       6-character room code. This component is the primary "share a session"
 *       surface for hosts.
 *
 * WHAT: - Big monospace code in text-4xl
 *       - Copy button (navigator.clipboard.writeText)
 *       - Share button (WhatsApp link as secondary option)
 *       - Participant count + session duration timer
 *       - End Session button for the host (calls TeamsService.closeSession)
 *
 * HOW:  Receives code, participantCount, sessionStart from TeamsPreSession
 *       (which reads them from TeamsService state after createSession succeeds).
 *
 * NOT:  Does not call TeamsService directly for session creation — that is
 *       handled by TeamsPreSession.
 */

import { useState, useEffect } from 'react'
import { Copy, Check, Share2, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ToastManager } from '@/components/Toast'
import { TeamsService } from '@/services/teams-service'

interface TeamsCodeDisplayProps {
    code: string
    participantCount: number
    sessionStartedAt: number
}

function formatDuration(startedAt: number): string {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000)
    const minutes = Math.floor(elapsed / 60)
    const seconds = elapsed % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function TeamsCodeDisplay({ code, participantCount, sessionStartedAt }: TeamsCodeDisplayProps) {
    const { t } = useTranslation()
    const [copied, setCopied] = useState(false)
    const [duration, setDuration] = useState(formatDuration(sessionStartedAt))

    // Update duration every second
    useEffect(() => {
        const interval = setInterval(() => {
            setDuration(formatDuration(sessionStartedAt))
        }, 1000)
        return () => clearInterval(interval)
    }, [sessionStartedAt])

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            ToastManager.getInstance().success(t('sidepanel.teamsCode.copiedToast'))
            setTimeout(() => setCopied(false), 2000)
        } catch {
            ToastManager.getInstance().error(t('sidepanel.teamsCode.copyFailed'))
        }
    }

    const handleShare = () => {
        const shareMessage = t('sidepanel.teamsCode.shareMessage', { code: `\u2066${code}\u2069` })
        const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`
        chrome.tabs.create({ url: shareUrl, active: false })
        // Also copy to clipboard as primary action
        navigator.clipboard.writeText(code).catch(() => {})
        ToastManager.getInstance().info(t('sidepanel.teamsCode.openingShare'))
    }

    const handleEndSession = () => {
        TeamsService.closeSession()
    }

    return (
        <div className="flex flex-col items-center gap-4 p-4">
            {/* Session code */}
            <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">{t('sidepanel.teamsCode.yourCode')}</p>
                <p dir="ltr" className="text-4xl font-mono font-bold tracking-widest text-foreground select-all">
                    {code}
                </p>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent text-sm font-medium transition-colors"
                >
                    {copied ? (
                        <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                        <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copied ? t('sidepanel.teamsCode.copied') : t('sidepanel.teamsCode.copy')}</span>
                </button>

                <button
                    onClick={handleShare}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent text-sm font-medium transition-colors"
                >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{t('sidepanel.teamsCode.share')}</span>
                </button>
            </div>

            {/* Session stats */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{t('sidepanel.teamsCode.participants', { count: participantCount })}</span>
                <span dir="ltr" className="font-mono">{duration}</span>
            </div>

            {/* End session */}
            <button
                onClick={handleEndSession}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors mt-2"
            >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t('sidepanel.teamsCode.endSession')}</span>
            </button>
        </div>
    )
}
