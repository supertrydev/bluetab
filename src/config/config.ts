/**
 * @module config/config
 *
 * WHY: Centralize all Supertry integration configuration.
 *      Makes it easy to switch between dev/prod environments.
 *
 * WHAT: Contains API URLs, timeouts, and feature gate settings.
 *
 * HOW: Export const config object used throughout the extension.
 *
 * NOT: Does not contain secrets - those come from runtime.
 */

export const config = {
    supertry: {
        baseUrl: 'https://supertry.net',
        apiUrl: 'https://supertry.net/api',
        authEndpoint: '/api/auth',
        subscriptionEndpoint: '/api/creem/subscription',
        wsUrl: 'wss://supertry.net',
        /**
         * MCP server endpoint (Phase 13 — separate Supertry service per
         * MCP-13). Distinct from /api/sync and /api/bridge so the JWT
         * `aud` claim and rate-limit budgets stay scope-segregated.
         * Snapshot push lands at `${mcpUrl}/snapshot`; tool dispatch /
         * async-queue protocol lives under the same root.
         *
         * Placeholder URL until the Supertry backend deployment lands —
         * the env will switch to the production hostname; the path stays.
         */
        mcpUrl: 'https://supertry.net/api/mcp',
    },
    auth: {
        tokenRefreshInterval: 30 * 60 * 1000, // 30 minutes
        sessionCheckInterval: 60 * 60 * 1000, // 1 hour
        offlineGracePeriod: 24 * 60 * 60 * 1000, // 24 hours
        maxLoginAttempts: 5,
        lockoutDuration: 15 * 60 * 1000, // 15 minutes
    },
    storage: {
        keys: {
            authToken: 'bluetab_auth_token',
            refreshToken: 'bluetab_refresh_token',
            user: 'bluetab_user',
            subscription: 'bluetab_subscription',
            lastCheck: 'bluetab_last_check',
            aiHistory: 'ai_history',
            aiSettings: 'ai_settings',
            aiAllowanceSummary: 'ai_allowance_summary',
        },
    },
    bluet: {
        baseUrl: 'https://bluet.in',
        apiUrl: 'https://bluet.in/api',
        bridgeAuthPath: '/auth/bridge',
        syncEndpoint: '/api/bridge/sync',
        statusEndpoint: '/api/bridge/status',
        unshareEndpoint: '/api/bridge/unshare',
        disconnectEndpoint: '/api/bridge/disconnect',
        // On config.supertry.apiUrl: signed proof of Bluetab Pro that Bluet verifies
        entitlementEndpoint: '/bluet/entitlement',
        requestTimeoutMs: 15_000,
        tokenLifetimeDays: 90,
    },
    premium: {
        // Features that require premium subscription
        features: [
            'cloud_sync',
            'cloud_backup',
            'team_sharing',
            'advanced_analytics',
            'priority_support',
            'flow',
            'ai_commands',
        ] as const,
    },
    ai: {
        chatEndpoint: '/ai/chat',
        nameGroupEndpoint: '/ai/name-group',
        organizeEndpoint: '/ai/organize',
        allowanceEndpoint: '/ai/allowance',
        searchEndpoint: '/ai/search',
        summarizePageEndpoint: '/ai/summarize-page',
        storageBudgetBytes: 200 * 1024,   // 200KB for ai_history + ai_settings
        historyMaxEntries: 50,
        maxTabsInContext: 50,
    },
    /**
     * Page Chrome opens after the extension is removed: a Tally form
     * ("Sorry to see you go") with hidden fields `version` and `lang`.
     * Only those two values are added to the URL, never user data.
     */
    uninstallSurvey: {
        url: 'https://tally.so/r/4aa6Kr',
    },
} as const

export type PremiumFeature = typeof config.premium.features[number]
