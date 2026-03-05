/**
 * @module components/bluet/BluetConnectionSection
 *
 * WHY: Display Bluet bridge connection status in Account page.
 *
 * WHAT: Shows connection state, username, stats, and connect/disconnect actions.
 *       Supports token paste flow: user opens Bluet auth, copies token, pastes here.
 *
 * HOW: Uses BluetBridgeService for data and actions, useAuth for Pro check.
 */

import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useAuth } from '../auth/useAuth'
import { BluetBridgeService } from '../../services/bluet-bridge-service'
import { ToastManager } from '../Toast'
import type { BluetBridgeStatus } from '../../types/bluet'
import {
    Link2,
    Link2Off,
    ExternalLink,
    RefreshCw,
    Lock,
    FileText,
    LinkIcon,
    ClipboardPaste,
    ArrowLeft,
} from 'lucide-react'

type ViewState = 'status' | 'token-input'

export function BluetConnectionSection() {
    const { isPro } = useAuth()
    const [status, setStatus] = useState<BluetBridgeStatus>({ connected: false })
    const [isLoading, setIsLoading] = useState(true)
    const [tokenInput, setTokenInput] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [view, setView] = useState<ViewState>('status')

    useEffect(() => {
        loadStatus()
    }, [])

    const loadStatus = async () => {
        setIsLoading(true)
        try {
            const bridgeData = await BluetBridgeService.getBridgeData()
            if (bridgeData) {
                // Start with local data (always available)
                const localStatus: BluetBridgeStatus = {
                    connected: true,
                    username: bridgeData.bluet.username,
                }

                // Try to enrich with API stats (may fail if offline)
                try {
                    const apiStatus = await BluetBridgeService.getStatus()
                    if (apiStatus.connected) {
                        setStatus({
                            ...localStatus,
                            username: apiStatus.username || localStatus.username,
                            totalPages: apiStatus.totalPages,
                            totalLinks: apiStatus.totalLinks,
                        })
                    } else {
                        setStatus(localStatus)
                    }
                } catch {
                    setStatus(localStatus)
                }
            } else {
                setStatus({ connected: false })
            }
        } catch {
            setStatus({ connected: false })
        }
        setIsLoading(false)
    }

    const handleOpenAuthPage = () => {
        BluetBridgeService.openAuthPage()
        setView('token-input')
    }

    const handleSaveToken = async () => {
        if (!tokenInput.trim()) return

        setIsSaving(true)
        const result = await BluetBridgeService.connectWithToken(tokenInput)

        if (result.success) {
            ToastManager.getInstance().success('Connected to Bluet!')
            setTokenInput('')
            setView('status')
            await loadStatus()
        } else {
            ToastManager.getInstance().error(result.error || 'Invalid token')
        }
        setIsSaving(false)
    }

    const handleDisconnect = async () => {
        await BluetBridgeService.disconnect()
        setStatus({ connected: false })
        ToastManager.getInstance().info('Disconnected from Bluet')
    }

    const handleOpenBluet = () => {
        if (status.username) {
            chrome.tabs.create({ url: `https://bluet.in/${status.username}` })
        }
    }

    return (
        <div className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                    <Link2 className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-medium text-text-strong">Bluet Connection</h3>
            </div>

            <div className="rounded-xl bg-bg-1 border border-border shadow-sm overflow-hidden">
                {!isPro ? (
                    /* Pro required state */
                    <div className="p-6 text-center">
                        <div className="w-12 h-12 rounded-full bg-bg-2 flex items-center justify-center mx-auto mb-3">
                            <Lock className="h-6 w-6 text-text-muted" />
                        </div>
                        <p className="text-sm text-text-muted">
                            Share to Bluet requires BlueTab Pro
                        </p>
                    </div>
                ) : isLoading ? (
                    /* Loading state */
                    <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 animate-spin text-text-muted" />
                    </div>
                ) : status.connected ? (
                    /* Connected state */
                    <div className="divide-y divide-border">
                        <div className="p-5">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-green-500" />
                                        <span className="font-medium text-text-strong">
                                            Connected as @{status.username}
                                        </span>
                                    </div>
                                    <button
                                        onClick={handleOpenBluet}
                                        className="flex items-center gap-1.5 text-sm text-primary hover:underline ml-4"
                                    >
                                        bluet.in/{status.username}
                                        <ExternalLink className="h-3 w-3" />
                                    </button>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleDisconnect}
                                    className="border-border text-text hover:bg-bg-2 hover:text-text-strong"
                                >
                                    <Link2Off className="h-3.5 w-3.5 mr-1.5" />
                                    Disconnect
                                </Button>
                            </div>
                        </div>

                        {/* Stats */}
                        {(status.totalPages !== undefined || status.totalLinks !== undefined) && (
                            <div className="px-5 py-3 bg-bg-0/50">
                                <div className="flex items-center gap-4 text-sm text-text-muted">
                                    {status.totalPages !== undefined && (
                                        <span className="flex items-center gap-1.5">
                                            <FileText className="h-3.5 w-3.5" />
                                            {status.totalPages} shared pages
                                        </span>
                                    )}
                                    {status.totalLinks !== undefined && (
                                        <span className="flex items-center gap-1.5">
                                            <LinkIcon className="h-3.5 w-3.5" />
                                            {status.totalLinks} links
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ) : view === 'token-input' ? (
                    /* Token paste state */
                    <div className="p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setView('status')}
                                className="p-1 rounded hover:bg-bg-2 text-text-muted"
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </button>
                            <span className="text-sm font-medium text-text-strong">
                                Paste your bridge token
                            </span>
                        </div>
                        <p className="text-xs text-text-muted">
                            Copy the token from the Bluet page and paste it below.
                        </p>
                        <div className="flex gap-2">
                            <Input
                                type="text"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder="eyJhbGci..."
                                className="flex-1 text-xs font-mono"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveToken()
                                }}
                            />
                            <Button
                                onClick={handleSaveToken}
                                disabled={!tokenInput.trim() || isSaving}
                                size="sm"
                                className="bg-primary hover:bg-primary-hover text-white"
                            >
                                {isSaving ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                    <ClipboardPaste className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* Disconnected state */
                    <div className="p-6 text-center">
                        <div className="w-12 h-12 rounded-full bg-bg-2 flex items-center justify-center mx-auto mb-3">
                            <Link2 className="h-6 w-6 text-text-muted" />
                        </div>
                        <p className="text-sm text-text-muted mb-4">
                            Share your tab groups as Bluet pages
                        </p>
                        <Button
                            onClick={handleOpenAuthPage}
                            className="bg-primary hover:bg-primary-hover text-white shadow-sm"
                        >
                            <Link2 className="h-4 w-4 mr-2" />
                            Connect to Bluet
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
