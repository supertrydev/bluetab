/**
 * @module sidepanel/components/TeamsSessionView
 *
 * WHY:  Active Teams session — the collaborative hub. Participants' shared tabs
 *       appear as real Chrome tab groups in the browser; this view shows session
 *       status, participant presence, your sharing controls, and shared groups.
 *
 * WHAT: Three visual sections inside a scrollable area:
 *       1. Participants — who's here, online/offline, tab count
 *       2. Your Sharing — share-all toggle + selective tab picker
 *       3. Shared Groups — received Bluetab groups with save action
 *       Plus a compact session bar and collapsible chat at the bottom.
 *
 * HOW:  Reads TeamsServiceState from props (owner: TeamsPanel).
 *       Follows the 3-layer surface + 4px grid design system.
 *
 * NOT:  Does not own the service lifecycle — TeamsPanel does that.
 *       Does not render individual remote tabs — browser tab groups handle that.
 */

import { useState, useEffect, useRef } from 'react'
import {
    Users, Copy, CheckCircle2, Share2, Loader2, WifiOff, RefreshCw,
    ChevronDown, LogOut, Monitor, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { getLanguageDirection } from '@/i18n'
import { isolateBidi } from '@/i18n/bidi'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { TeamsService } from '@/services/teams-service'
import { Storage } from '@/utils/storage'
import { getAuthState } from '@/utils/auth-state'
import { ParticipantListRow, ParticipantSummaryRow } from './TeamsParticipant'
import { TeamsChatPanel } from './TeamsChatPanel'
import type { TeamsServiceState, TeamsGroupShare } from '@/types/teams'
import type { TabGroup } from '@/types/models'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OwnTab {
    id: number
    title: string
    url: string
    favicon?: string
}

// ─── Section Header ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-1 pb-1 text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {children}
        </p>
    )
}

// ─── Group Picker Dialog ──────────────────────────────────────────────────────

function GroupPickerDialog({
    onSelect,
    onClose,
}: {
    onSelect: (group: TabGroup) => void
    onClose: () => void
}) {
    const { t } = useTranslation()
    const [groups, setGroups] = useState<TabGroup[]>([])
    const [loading, setLoading] = useState(true)
    const dialogRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        Storage.get<TabGroup[]>('groups').then((data) => {
            setGroups(data ?? [])
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [])

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
                onClose()
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [onClose])

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-background/60 backdrop-blur-sm">
            <div
                ref={dialogRef}
                className="w-full max-w-sm bg-popover border border-border rounded-xl shadow-lg p-4 flex flex-col gap-3"
            >
                <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{t('sidepanel.teamsSession.shareGroupTitle')}</span>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">
                        {t('common.cancel')}
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                ) : groups.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">{t('sidepanel.teamsSession.noSavedGroups')}</p>
                ) : (
                    <ul className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                        {groups.map((g) => (
                            <li key={g.id}>
                                <button
                                    onClick={() => onSelect(g)}
                                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent transition-colors text-start"
                                >
                                    <bdi dir="auto" className="text-sm font-medium truncate">{g.name}</bdi>
                                    <span className="text-xs text-muted-foreground flex-shrink-0 ms-2">
                                        {t('common.tabsCount', { count: g.tabs.length })}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface TeamsSessionViewProps {
    state: TeamsServiceState
}

export function TeamsSessionView({ state }: TeamsSessionViewProps) {
    const { t, i18n } = useTranslation()
    const { session, participants, connectionState, chatMessages, unreadCount, groupShares } = state

    // Participant sidebar
    const [sidebarOpen, setSidebarOpen] = useState(false)

    // Tab sharing
    const [shareAll, setShareAll] = useState(false)
    const [ownTabs, setOwnTabs] = useState<OwnTab[]>([])
    const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set())
    const [tabSectionOpen, setTabSectionOpen] = useState(false)

    // Groups
    const [showGroupPicker, setShowGroupPicker] = useState(false)
    const [savedGroupId, setSavedGroupId] = useState<string | null>(null)

    // Code copy
    const [codeCopied, setCodeCopied] = useState(false)

    // Current user
    const [currentUserId, setCurrentUserId] = useState<string | null>(null)

    const isHost = session?.role === 'host'
    const isRtl = getLanguageDirection(i18n.resolvedLanguage ?? i18n.language) === 'rtl'
    const isolatedSessionCode = isolateBidi(session?.code ?? '', 'ltr')

    // ─── Effects ──────────────────────────────────────────────────────────────

    useEffect(() => {
        getAuthState().then((auth) => {
            if (auth.user?.id) setCurrentUserId(auth.user.id)
        }).catch(() => {})
    }, [])

    useEffect(() => {
        const queryTabs = () => {
            chrome.tabs.query({ currentWindow: true }).then((tabs) => {
                setOwnTabs(
                    tabs
                        .filter((t) => t.id !== undefined && t.url)
                        .map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url!, favicon: t.favIconUrl }))
                )
            }).catch(() => {})
        }
        queryTabs()

        const onCreated = () => queryTabs()
        const onRemoved = () => queryTabs()
        const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
            if (info.status === 'complete' || info.title || info.url) queryTabs()
        }
        chrome.tabs.onCreated.addListener(onCreated)
        chrome.tabs.onRemoved.addListener(onRemoved)
        chrome.tabs.onUpdated.addListener(onUpdated)
        return () => {
            chrome.tabs.onCreated.removeListener(onCreated)
            chrome.tabs.onRemoved.removeListener(onRemoved)
            chrome.tabs.onUpdated.removeListener(onUpdated)
        }
    }, [])

    // ─── Handlers ─────────────────────────────────────────────────────────────

    const handleShareAllToggle = (enabled: boolean) => {
        setShareAll(enabled)
        TeamsService.setShareAllMode(enabled)
    }

    const handleTabCheckbox = (tabId: number, checked: boolean) => {
        setSelectedTabIds((prev) => {
            const next = new Set(prev)
            if (checked) next.add(tabId)
            else next.delete(tabId)
            TeamsService.setSelectedTabs([...next])
            return next
        })
    }

    const handleSelectAll = () => {
        const allIds = new Set(ownTabs.map((t) => t.id))
        setSelectedTabIds(allIds)
        TeamsService.setSelectedTabs([...allIds])
    }

    const handleDeselectAll = () => {
        setSelectedTabIds(new Set())
        TeamsService.setSelectedTabs([])
    }

    const allSelected = ownTabs.length > 0 && ownTabs.every((t) => selectedTabIds.has(t.id))

    const handleCopyCode = () => {
        if (!session?.code) return
        navigator.clipboard.writeText(session.code).catch(() => {})
        setCodeCopied(true)
        setTimeout(() => setCodeCopied(false), 2000)
    }

    const handleGroupSelect = (group: TabGroup) => {
        setShowGroupPicker(false)
        TeamsService.pushGroup({
            id: group.id,
            name: group.name,
            tabs: group.tabs.map((t) => ({ title: t.title, url: t.url, favicon: t.favicon ?? undefined })),
        })
    }

    const handleSaveGroup = async (share: TeamsGroupShare) => {
        const key = `${share.senderId}-${share.receivedAt}`
        try {
            const existing = (await Storage.get<TabGroup[]>('groups')) ?? []
            const now = Date.now()
            const groupId = crypto.randomUUID()
            const newGroup: TabGroup = {
                id: groupId,
                name: share.group.name,
                tabs: share.group.tabs.map((t) => ({
                    id: crypto.randomUUID(), title: t.title, url: t.url, favicon: t.favicon, timestamp: now, groupId,
                })),
                created: now,
                modified: now,
            }
            await Storage.set('groups', [newGroup, ...existing])
            setSavedGroupId(key)
            setTimeout(() => setSavedGroupId(null), 2500)
        } catch (err) {
            console.error('[TeamsSessionView] handleSaveGroup error:', err)
        }
    }

    const handleEndOrLeave = () => {
        if (isHost) TeamsService.closeSession()
        else TeamsService.disconnect()
    }

    // ─── Error state ──────────────────────────────────────────────────────────

    if (connectionState === 'error') {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
                <WifiOff className="w-8 h-8 text-muted-foreground" />
                <div>
                    <p className="text-sm font-medium text-foreground">{t('sidepanel.teamsSession.connectionLostTitle')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('sidepanel.teamsSession.connectionLostDescription')}</p>
                </div>
                <button
                    onClick={() => { if (session?.code) TeamsService.joinSession(session.code).catch(() => {}) }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('sidepanel.teamsSession.retry')}
                </button>
                <button onClick={() => TeamsService.disconnect()} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {t('sidepanel.teamsSession.leaveSession')}
                </button>
            </div>
        )
    }

    // ─── Active Render ────────────────────────────────────────────────────────

    const sharingCount = shareAll ? ownTabs.length : selectedTabIds.size

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden">

            {/* ── Session Bar ── */}
            <div
                data-testid="teams-session-header"
                className="flex min-w-0 flex-shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-1.5"
            >
                {/* Code badge */}
                <button
                    type="button"
                    data-testid="session-code-button"
                    onClick={handleCopyCode}
                    className="flex min-w-0 max-w-[96px] items-center gap-1 rounded-md bg-muted px-1.5 py-1 font-mono text-xs font-semibold tracking-wider hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={`${t('sidepanel.teamsSession.copySessionCode')}: ${isolatedSessionCode}`}
                    aria-label={`${t('sidepanel.teamsSession.copySessionCode')}: ${isolatedSessionCode}`}
                >
                    <span data-testid="session-code-text" dir="ltr" className="min-w-0 truncate">{session?.code}</span>
                    {codeCopied
                        ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                        : <Copy className="w-3 h-3 text-muted-foreground" />
                    }
                </button>

                {/* Connection status */}
                <span className={cn(
                    'flex flex-shrink-0 items-center gap-1 text-caption',
                    connectionState === 'connected' && 'text-green-600 dark:text-green-400',
                    connectionState === 'connecting' && 'text-yellow-600 dark:text-yellow-400',
                    connectionState === 'disconnected' && 'text-muted-foreground'
                )}>
                    <span className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        connectionState === 'connected' && 'bg-green-500',
                        connectionState === 'connecting' && 'bg-yellow-400 animate-pulse',
                        connectionState === 'disconnected' && 'bg-muted-foreground/40'
                    )} />
                    {connectionState === 'connected'
                        ? t('sidepanel.teamsSession.live')
                        : connectionState === 'connecting'
                            ? t('sidepanel.teamsSession.connecting')
                            : t('sidepanel.teamsSession.offline')}
                </span>

                <div className="min-w-0 flex-1" />

                {/* Participant count */}
                <span
                    className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground"
                    aria-label={t('sidepanel.teamsSession.participantsCount', { count: participants.length })}
                >
                    <Users className="w-3 h-3" />
                    {participants.length}
                </span>

                {/* End / Leave */}
                <button
                    type="button"
                    data-testid="end-session-button"
                    onClick={handleEndOrLeave}
                    className={cn(
                        'flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isHost
                            ? 'text-destructive hover:bg-destructive/10'
                            : 'text-muted-foreground hover:bg-accent'
                    )}
                >
                    <LogOut className="w-3 h-3" />
                    {isHost ? t('sidepanel.teamsSession.end') : t('sidepanel.teamsSession.leave')}
                </button>
            </div>

            {/* ── Scrollable Content ── */}
            <div className="min-h-0 flex-shrink overflow-y-auto scrollbar-transparent">

                {/* Connecting state */}
                {connectionState === 'connecting' && participants.length === 0 && (
                    <div className="flex items-center justify-center gap-2 px-3 py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{t('sidepanel.teamsSession.connecting')}</span>
                    </div>
                )}

                {/* ── Section: Participants (horizontal avatar bar) ── */}
                {(participants.length > 0 || connectionState !== 'connecting') && (
                    <div className="border-b border-border px-2.5 py-1.5">
                        {participants.length === 0 ? (
                            <p className="px-1 py-1.5 text-xs text-muted-foreground">
                                {t('sidepanel.teamsSession.waitingForOthers')}
                            </p>
                        ) : (
                            <ParticipantSummaryRow
                                participants={participants}
                                label={t('sidepanel.teamsSession.participantsCount', { count: participants.length })}
                                expanded={sidebarOpen}
                                drawerSide={isRtl ? 'left' : 'right'}
                                onClick={() => setSidebarOpen(true)}
                            />
                        )}
                    </div>
                )}

                {/* ── Section: Your Sharing ── */}
                <div className="border-b border-border px-2.5 py-2">
                    <SectionLabel>
                        {t('sidepanel.teamsSession.yourSharing')}
                        <span className="ms-1 normal-case tracking-normal text-foreground/60">
                            {sharingCount > 0 ? t('common.tabsCount', { count: sharingCount }) : t('sidepanel.teamsSession.off')}
                        </span>
                    </SectionLabel>

                    {/* Share all toggle */}
                    <div className="flex items-center justify-between gap-3 rounded-md px-1 py-1">
                        <div className="flex items-center gap-2">
                            <Monitor className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs">{t('sidepanel.teamsSession.shareAllTabs')}</span>
                        </div>
                        <Switch
                            data-testid="share-all-tabs-switch"
                            checked={shareAll}
                            onCheckedChange={handleShareAllToggle}
                            aria-label={t('sidepanel.teamsSession.shareAllTabs')}
                        />
                    </div>

                    {/* Selective tab picker */}
                    {!shareAll && ownTabs.length > 0 && (
                        <Collapsible open={tabSectionOpen} onOpenChange={setTabSectionOpen}>
                            <CollapsibleTrigger asChild>
                                <button
                                    type="button"
                                    data-testid="select-individual-tabs-trigger"
                                    className="mx-0 flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-start hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <span className="flex-1 text-xs text-muted-foreground">
                                        {t('sidepanel.teamsSession.selectIndividualTabs')}
                                        {selectedTabIds.size > 0 && (
                                            <span className="ms-1 text-foreground">({selectedTabIds.size})</span>
                                        )}
                                    </span>
                                    <ChevronDown className={cn(
                                        'w-3.5 h-3.5 text-muted-foreground transition-transform',
                                        tabSectionOpen && 'rotate-180'
                                    )} />
                                </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <div className="space-y-0.5 px-1 pb-1.5">
                                    <div className="flex justify-end py-0.5">
                                        <button
                                            onClick={allSelected ? handleDeselectAll : handleSelectAll}
                                            className="text-micro text-primary hover:text-primary/80 transition-colors"
                                        >
                                            {allSelected ? t('sidepanel.teamsSession.deselectAll') : t('sidepanel.teamsSession.selectAll')}
                                        </button>
                                    </div>
                                    {ownTabs.map((tab) => (
                                        <label
                                            key={tab.id}
                                            className="flex items-center gap-2 py-1 px-1 rounded hover:bg-accent cursor-pointer transition-colors"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedTabIds.has(tab.id)}
                                                onChange={(e) => handleTabCheckbox(tab.id, e.target.checked)}
                                                className="w-3 h-3 rounded accent-primary flex-shrink-0"
                                            />
                                            {tab.title ? (
                                                <bdi dir="auto" className="text-xs truncate">{tab.title}</bdi>
                                            ) : (
                                                <bdi dir="ltr" className="text-xs truncate">{tab.url}</bdi>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </div>

                {/* ── Section: Shared Groups ── */}
                <div className="px-2.5 py-2">
                    <SectionLabel>{t('sidepanel.teamsSession.sharedGroups')}</SectionLabel>

                    <div className="space-y-1.5">
                        {groupShares.length > 0 && groupShares.map((share) => {
                            const isOwnShare = currentUserId && share.senderId === currentUserId
                            const key = `${share.senderId}-${share.receivedAt}`
                            const isSaved = savedGroupId === key
                            return (
                                <div key={key} className="space-y-1.5 rounded-lg border border-border p-2.5">
                                    <div className="flex items-center justify-between">
                                        <bdi dir="auto" className="text-xs font-medium truncate">{share.group.name}</bdi>
                                        <span className="text-micro text-muted-foreground flex-shrink-0 ms-2">
                                            {t('common.tabsCount', { count: share.group.tabs.length })}
                                        </span>
                                    </div>
                                    <p dir="auto" className="text-micro text-muted-foreground">
                                        {isOwnShare
                                            ? t('sidepanel.teamsSession.sharedByYou')
                                            : t('sidepanel.teamsSession.sharedByOther', {
                                                name: `\u2068${share.senderName}\u2069`,
                                            })}
                                    </p>
                                    {!isOwnShare && (
                                        <button
                                            onClick={() => handleSaveGroup(share)}
                                            disabled={isSaved}
                                            className={cn(
                                                'w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all',
                                                isSaved
                                                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                                            )}
                                        >
                                            {isSaved ? (
                                                <><CheckCircle2 className="w-3.5 h-3.5" />{t('sidepanel.teamsSession.saved')}</>
                                            ) : t('sidepanel.teamsSession.saveToMyBluetab')}
                                        </button>
                                    )}
                                </div>
                            )
                        })}

                        {groupShares.length === 0 ? (
                            <div
                                data-testid="shared-groups-empty"
                                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-2"
                            >
                                <p className="min-w-0 truncate text-xs text-muted-foreground">
                                    {t('sidepanel.teamsSession.noGroupsSharedYet')}
                                </p>
                                <button
                                    type="button"
                                    data-testid="share-group-button"
                                    onClick={() => setShowGroupPicker(true)}
                                    className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <Share2 className="h-3.5 w-3.5" />
                                    {t('sidepanel.teamsSession.shareGroupTitle')}
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                data-testid="share-group-button"
                                onClick={() => setShowGroupPicker(true)}
                                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <Share2 className="h-3.5 w-3.5" />
                                {t('sidepanel.teamsSession.shareGroupTitle')}
                            </button>
                        )}
                    </div>
                </div>

            </div>

            {/* ── Chat ── */}
            <div className="flex min-h-0 flex-1 flex-col justify-end">
                <TeamsChatPanel
                    chatMessages={chatMessages}
                    unreadCount={unreadCount}
                    isConnected={connectionState === 'connected'}
                    onSendChat={(text) => TeamsService.sendChat(text)}
                    onMarkRead={() => TeamsService.markChatRead()}
                />
            </div>

            {/* Group picker dialog */}
            {showGroupPicker && (
                <GroupPickerDialog onSelect={handleGroupSelect} onClose={() => setShowGroupPicker(false)} />
            )}

            {/* ── Participant Sidebar (slide-out) ── */}
            {sidebarOpen && (
                <div className="absolute inset-0 z-40">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-background/50 backdrop-blur-[2px]"
                        onClick={() => setSidebarOpen(false)}
                    />
                    {/* Panel */}
                    <div
                        id="teams-participants-drawer"
                        data-testid="participants-drawer"
                        data-side={isRtl ? 'left' : 'right'}
                        className={cn(
                            'absolute inset-y-0 flex h-full w-[min(260px,85vw)] flex-col border-border bg-background shadow-lg animate-in duration-200',
                            isRtl
                                ? 'left-0 border-r slide-in-from-left'
                                : 'right-0 border-l slide-in-from-right'
                        )}
                    >
                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                            <span className="text-xs font-semibold">{t('sidepanel.teamsSession.participantsCount', { count: participants.length })}</span>
                            <button
                                type="button"
                                onClick={() => setSidebarOpen(false)}
                                className="rounded-md p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={t('common.close')}
                            >
                                <X className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto scrollbar-transparent py-1">
                            {participants.map((p) => (
                                <ParticipantListRow key={p.userId} participant={p} isHost={p.role === 'host'} />
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
