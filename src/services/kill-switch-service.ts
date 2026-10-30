/**
 * kill-switch-service.ts — Remote AI feature kill switch (PRIVACY-03)
 *
 * WHY: Supertry may need to disable AI-over-history features (DETECT + DESIGN) in an
 *      emergency (e.g. privacy incident). The kill switch is fetched from a Supertry
 *      config endpoint and cached locally for 4 hours.
 * WHAT: Exports KillSwitchService static class with fetchConfig() + isEnabled().
 * HOW:  Fail-open semantics: if the fetch fails or there is no cache, the feature
 *       is treated as ENABLED. The kill switch exists for emergencies, not routine
 *       access control — failing closed on every network hiccup is unacceptable.
 *
 * Storage key: 'ai_kill_switch_cache'
 * Cache TTL:   4 hours
 */

import { Storage } from '../utils/storage';
import { config } from '../config/config';

interface KillSwitchCache {
    enabled: boolean;   // true = AI-over-history features enabled
    fetchedAt: number;  // epoch ms when this cache entry was written
    /**
     * Phase 13 MCP-server kill switch (PRIVACY-03 reuse). When true,
     * Supertry is asking clients to stop pushing snapshots and to expect
     * `service_unavailable` from the MCP read/write endpoints. Server
     * surface only — user-added MCP client endpoints are NOT affected.
     * Optional for back-compat: the existing 4h-cache may not yet
     * carry this field for users who upgrade mid-cycle, in which case
     * `readMCPServerKillSwitch` returns false (fail-open — same
     * semantics as `isEnabled`, no surprise blocking).
     */
    mcpServerDisabled?: boolean;
    /**
     * Phase 14 — Integration kill switches (INTEG-15).
     * integrationsDisabled: true → ALL integrations are paused.
     * integrationDisabled: string[] → specific integration ids paused.
     * Optional for back-compat (fail-open: absent = no kill switch active).
     */
    integrationsDisabled?: boolean;
    integrationDisabled?: string[];
}

const STORAGE_KEY = 'ai_kill_switch_cache';
export const KILL_SWITCH_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class KillSwitchService {
    /**
     * Fetch the kill-switch config from Supertry and cache it locally.
     *
     * - No-op if the cached value is still fresh (<4h).
     * - On fetch error or non-2xx response: logs the error and keeps the existing
     *   cache (fail-open — prior state stands).
     * - Uses AbortSignal.timeout(5000) to avoid hanging on slow responses.
     *
     * @param token   User's Supertry auth token (Bearer)
     */
    static async fetchConfig(token: string): Promise<void> {
        const cached = await Storage.get<KillSwitchCache>(STORAGE_KEY);
        const now = Date.now();

        // No-op if cache is still fresh
        if (cached && now - cached.fetchedAt < KILL_SWITCH_CACHE_TTL_MS) {
            return;
        }

        try {
            const response = await fetch(
                `${config.supertry.apiUrl}/config`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: AbortSignal.timeout(5000),
                }
            );

            if (!response.ok) {
                // Non-2xx response — fail-open: keep existing cache
                console.warn(`[BlueTab][KillSwitchService] Config fetch returned ${response.status} — keeping existing cache`);
                return;
            }

            const data = await response.json() as {
                ai_history_features_enabled: boolean;
                mcp_server_disabled?: boolean;
            };
            const newCache: KillSwitchCache = {
                enabled: data.ai_history_features_enabled,
                fetchedAt: now,
                ...(typeof data.mcp_server_disabled === 'boolean'
                    ? { mcpServerDisabled: data.mcp_server_disabled }
                    : {}),
            };
            await Storage.set(STORAGE_KEY, newCache);
        } catch (error) {
            // Network error / timeout — fail-open: keep existing cache
            console.warn('[BlueTab][KillSwitchService] Config fetch failed — keeping existing cache:', error);
        }
    }

    /**
     * Check whether AI-over-history features are currently enabled.
     *
     * Fail-open: returns true if there is no cache (the safest default for a kill switch
     * that exists for emergencies, not routine access control).
     *
     * @returns true if features are enabled (or cache is absent), false if kill switch is active
     */
    static async isEnabled(): Promise<boolean> {
        const cached = await Storage.get<KillSwitchCache>(STORAGE_KEY);
        return cached?.enabled ?? true; // fail-open default
    }

    /**
     * Phase 13 — Read the MCP-server kill switch (PRIVACY-03 reuse).
     *
     * Returns TRUE when Supertry has asked the MCP server surface to
     * pause (snapshot pushes stop, server returns `service_unavailable`).
     * Returns FALSE in all other cases — including the cache-absent and
     * field-missing branches. The asymmetry vs `isEnabled` is
     * intentional: `isEnabled` defaults TRUE because the AI-over-history
     * features should keep working in the absence of an explicit kill;
     * `readMCPServerKillSwitch` defaults FALSE because the MCP server
     * surface is NEW in v3.0, the field is OPTIONAL on the wire, and
     * a missing field means "no kill switch active for this surface."
     * Both paths are fail-open in the sense that a network outage does
     * NOT activate the kill (the user keeps the existing cache state).
     *
     * @returns true when the MCP server should be paused, false otherwise
     */
    static async readMCPServerKillSwitch(): Promise<boolean> {
        const cached = await Storage.get<KillSwitchCache>(STORAGE_KEY);
        return cached?.mcpServerDisabled === true;
    }

    /**
     * Phase 14 — Check whether a specific integration is kill-switched.
     *
     * Returns true if Supertry has asked for:
     *   - All integrations to pause (integrationsDisabled === true), OR
     *   - This specific integration to pause (integrationDisabled includes id).
     *
     * Fail-open: returns false when cache is absent or field is missing.
     *
     * @param integrationId — the integration id to check (e.g. 'notion', 'linear')
     */
    static async isIntegrationDisabled(integrationId: string): Promise<boolean> {
        const cached = await Storage.get<KillSwitchCache>(STORAGE_KEY);
        if (!cached) return false;
        if (cached.integrationsDisabled === true) return true;
        if (Array.isArray(cached.integrationDisabled) && cached.integrationDisabled.includes(integrationId)) {
            return true;
        }
        return false;
    }
}
