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
        },
    },
    bluet: {
        baseUrl: 'https://bluet.in',
        apiUrl: 'https://bluet.in/api',
        bridgeAuthPath: '/auth/bridge',
        syncEndpoint: '/api/bridge/sync',
        statusEndpoint: '/api/bridge/status',
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
        ] as const,
    },
} as const

export type PremiumFeature = typeof config.premium.features[number]
