/**
 * @module components/auth/useAuth
 *
 * WHY: React hook for auth state in UI components.
 *
 * WHAT: Provides auth state and actions for React components.
 *
 * HOW: Wraps AuthService and AuthState for React lifecycle.
 */

import { requestAccountDataConsent } from '@/platform/extension-platform'
import { useState, useEffect, useCallback } from 'react'
import { AuthService } from '../../services/auth-service'
import * as AuthState from '../../utils/auth-state'
import type { AuthState as AuthStateType, User, SubscriptionStatus } from '../../types/auth'

export interface UseAuthReturn {
    isLoggedIn: boolean
    isLoading: boolean
    user: User | null
    subscription: SubscriptionStatus | null
    isPro: boolean
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
    logout: () => Promise<void>
    refresh: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
    const [authState, setAuthState] = useState<AuthStateType>({
        isLoggedIn: false,
        user: null,
        subscription: null,
        isPro: false,
        lastChecked: 0,
        offlineSince: null,
    })
    const [isLoading, setIsLoading] = useState(true)

    const loadAuthState = useCallback(async () => {
        setIsLoading(true)
        try {
            const state = await AuthState.getAuthState()
            setAuthState(state)
        } catch (error) {
            console.error('[BlueTab][useAuth] Failed to load auth state:', error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    // Load initial state
    useEffect(() => {
        void loadAuthState()
    }, [loadAuthState])

    // Listen for storage changes (from other extension views)
    useEffect(() => {
        const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.bluetab_auth_token) {
                void loadAuthState()
            }
        }

        chrome.storage.local.onChanged.addListener(handleStorageChange)
        return () => {
            chrome.storage.local.onChanged.removeListener(handleStorageChange)
        }
    }, [loadAuthState])

    const login = useCallback(async (email: string, password: string) => {
        // Firefox: built-in data collection consent, requested synchronously
        // inside the submit event (no await before it). Always true in Chrome.
        const consented = await requestAccountDataConsent()
        if (!consented) {
            return {
                success: false,
                error: 'Signing in needs your permission to send account and sync data to Supertry. Allow it in the Firefox prompt to continue.',
            }
        }
        setIsLoading(true)
        try {
            const result = await AuthService.login(email, password)

            if (result.success) {
                await loadAuthState()
            }

            return {
                success: result.success,
                error: result.error,
            }
        } finally {
            setIsLoading(false)
        }
    }, [loadAuthState])

    const logout = useCallback(async () => {
        setIsLoading(true)
        try {
            await AuthService.logout()
            await loadAuthState()
        } finally {
            setIsLoading(false)
        }
    }, [loadAuthState])

    const refresh = useCallback(async () => {
        await AuthService.refreshTokenIfNeeded()
        await AuthService.checkSubscription()
        await loadAuthState()
    }, [loadAuthState])

    return {
        isLoggedIn: authState.isLoggedIn,
        isLoading,
        user: authState.user,
        subscription: authState.subscription,
        isPro: authState.isPro,
        login,
        logout,
        refresh,
    }
}
