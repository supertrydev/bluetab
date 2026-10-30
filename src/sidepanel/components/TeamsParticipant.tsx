/**
 * @module sidepanel/components/TeamsParticipant
 *
 * WHY:  Participant display for the Teams session. Two modes:
 *       1. Avatar tile — compact square with initials + status dot (for the bar)
 *       2. List row — full name, status, host badge, tab count (for the sidebar)
 *
 * NOT:  Does not show individual tabs — those live as browser tab groups.
 */

import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Participant } from '@/types/teams'
import { useTranslation } from 'react-i18next'

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
}

// ─── Summary Row (compact, for the active-session surface) ───────────────────

interface ParticipantSummaryRowProps {
    participants: Participant[]
    label: string
    expanded: boolean
    drawerSide: 'left' | 'right'
    onClick: () => void
}

export function ParticipantSummaryRow({
    participants,
    label,
    expanded,
    drawerSide,
    onClick,
}: ParticipantSummaryRowProps) {
    const first = participants[0]
    const isSingle = participants.length === 1

    return (
        <button
            type="button"
            data-testid="participants-summary"
            onClick={onClick}
            aria-label={label}
            aria-expanded={expanded}
            aria-controls="teams-participants-drawer"
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-start hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <div className="flex flex-shrink-0" aria-hidden="true">
                {participants.slice(0, 3).map((participant) => (
                    <div
                        key={participant.userId}
                        className="relative -ms-1.5 flex h-7 w-7 items-center justify-center rounded-md border border-background bg-muted first:ms-0"
                        title={participant.displayName}
                    >
                        <span className="select-none text-micro font-semibold text-foreground/80">
                            {getInitials(participant.displayName)}
                        </span>
                        <span className={cn(
                            'absolute -bottom-0.5 -end-0.5 h-2 w-2 rounded-full border-[1.5px] border-background',
                            participant.status === 'online' ? 'bg-green-500' : 'bg-muted-foreground/40'
                        )} />
                    </div>
                ))}
            </div>

            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {isSingle ? <bdi dir="auto">{first.displayName}</bdi> : label}
            </span>

            {participants.length > 3 && (
                <span dir="ltr" className="flex-shrink-0 text-micro text-muted-foreground">
                    +{participants.length - 3}
                </span>
            )}

            <ChevronRight
                data-testid="participants-drawer-arrow"
                data-direction={drawerSide}
                className={cn(
                    'h-3.5 w-3.5 flex-shrink-0 text-muted-foreground',
                    drawerSide === 'left' && '-scale-x-100'
                )}
            />
        </button>
    )
}

// ─── Avatar Tile (compact, for horizontal bar) ────────────────────────────────

interface AvatarTileProps {
    participant: Participant
    isHost: boolean
    onClick?: () => void
}

export function ParticipantAvatarTile({ participant, isHost, onClick }: AvatarTileProps) {
    const { t } = useTranslation()
    const isOnline = participant.status === 'online'

    return (
        <button
            onClick={onClick}
            className="relative flex-shrink-0 w-9 h-9 rounded-lg bg-muted flex items-center justify-center hover:bg-accent transition-colors group"
            title={`${participant.displayName}${isHost ? ` (${t('components.teams.host')})` : ''}`}
        >
            <bdi dir="auto" className="text-caption font-semibold text-foreground/80 select-none">
                {getInitials(participant.displayName)}
            </bdi>

            {/* Status dot — bottom inline-end corner */}
            <span className={cn(
                'absolute -bottom-0.5 -end-0.5 w-2.5 h-2.5 rounded-full border-2 border-background',
                isOnline ? 'bg-green-500' : 'bg-muted-foreground/40'
            )} />

            {/* Host indicator — small crown-like top inline-start dot */}
            {isHost && (
                <span className="absolute -top-0.5 -start-0.5 w-2 h-2 rounded-full bg-primary border border-background" />
            )}
        </button>
    )
}

// ─── List Row (full detail, for sidebar) ──────────────────────────────────────

interface ListRowProps {
    participant: Participant
    isHost: boolean
}

export function ParticipantListRow({ participant, isHost }: ListRowProps) {
    const { t } = useTranslation()
    const isOnline = participant.status === 'online'
    const tabCount = participant.tabs.length

    return (
        <div className="flex items-center gap-2.5 px-3 py-2">
            {/* Avatar */}
            <div className="relative flex-shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <bdi dir="auto" className="text-micro font-semibold text-foreground/80">
                    {getInitials(participant.displayName)}
                </bdi>
                <span className={cn(
                    'absolute -bottom-0.5 -end-0.5 w-2 h-2 rounded-full border-[1.5px] border-background',
                    isOnline ? 'bg-green-500' : 'bg-muted-foreground/40'
                )} />
            </div>

            {/* Name */}
            <div className="flex-1 min-w-0">
                <span className={cn('text-xs truncate block', isHost && 'font-semibold')}>
                    <bdi dir="auto">{participant.displayName}</bdi>
                </span>
                <span className="text-micro text-muted-foreground">
                    {isOnline ? t('components.teams.online') : t('components.teams.offline')}
                    {tabCount > 0 && ` · ${t('components.teams.tab', { count: tabCount })}`}
                </span>
            </div>

            {/* Host badge */}
            {isHost && (
                <span className="flex-shrink-0 text-tiny font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {t('components.teams.host')}
                </span>
            )}
        </div>
    )
}

// ─── Backward compat default export ───────────────────────────────────────────

export function TeamsParticipant({ participant, isHost }: ListRowProps) {
    return <ParticipantListRow participant={participant} isHost={isHost} />
}
