/**
 * @module sidepanel/components/TeamsPanel
 *
 * WHY:  Root component for the Teams tab in the sidepanel. Subscribes to
 *       TeamsService state and routes to the correct sub-view.
 *
 * WHAT: - Checks for a persisted session on mount and attempts auto-rejoin
 *       - Subscribes to TeamsService state changes
 *       - Routes: no session → TeamsPreSession, has session → TeamsSessionView
 *
 * HOW:  Same ownership model as PomodoroBar — service state flows down via
 *       TeamsService.onStateChange which drives local React state.
 *
 * NOT:  Does not manage tab events directly — TeamsService handles that.
 *       Does not call disconnect on unmount — session persists across sidepanel close.
 */

import { useState, useEffect } from 'react'
import { TeamsService } from '@/services/teams-service'
import { Storage } from '@/utils/storage'
import type { TeamsServiceState, TeamsSessionPersisted } from '@/types/teams'
import { TeamsPreSession } from './TeamsPreSession'
import { TeamsSessionView } from './TeamsSessionView'

export function TeamsPanel() {
    const [state, setState] = useState<TeamsServiceState>(TeamsService.getState())

    useEffect(() => {
        // If already connected (module state survives within same context), just sync
        const current = TeamsService.getState()
        if (current.connectionState === 'connected' && current.session) {
            setState(current)
        } else {
            // Check for a persisted session and attempt rejoin
            // No client-side time gate — server decides if session/reconnect window is valid
            const checkPersisted = async () => {
                const saved = await Storage.get<TeamsSessionPersisted>('teams_session')
                if (saved) {
                    await TeamsService.joinSession(saved.sessionCode)
                }
            }
            checkPersisted().catch(() => {})
        }

        TeamsService.onStateChange(setState)

        // Only unsubscribe on unmount — do NOT disconnect.
        // The WS dies with the sidepanel context anyway, but the persisted
        // session must survive so the next open can rejoin.
        return () => {
            TeamsService.offStateChange(setState)
        }
    }, [])

    // Has session (connecting, connected, error, reconnecting) → show session view
    // TeamsSessionView handles all connection states internally
    if (state.session) {
        return <TeamsSessionView state={state} />
    }

    // No session — show pre-session entry point
    return <TeamsPreSession />
}
