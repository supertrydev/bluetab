/**
 * @module components/auth/useAuth
 *
 * WHY: React hook for auth state in UI components.
 *
 * WHAT: Provides auth state and actions for React components.
 *
 * HOW: Wraps AuthService and AuthState for React lifecycle.
 */

import { useState } from 'react'
import type { User, SubscriptionStatus } from '../../types/auth'

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
    // Hardcoded for OSS Release
    const [isLoading] = useState(false)

    return {
        isLoggedIn: false,
        isLoading,
        user: null,
        subscription: null,
        isPro: false,
        login: async () => ({ success: false, error: 'Login disabled in Open Source version.' }),
        logout: async () => { },
        refresh: async () => { },
    }
}
