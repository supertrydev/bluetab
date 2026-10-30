/**
 * @module services/ai-allowance-service
 *
 * WHY: Bluetab needs one shared, server-backed source for AI allowance state
 *      so every AI surface reflects the backend's real enforcement window.
 *
 * WHAT: Provides cached allowance summary fetch/refresh helpers plus a
 *       chrome.storage subscription for Settings and other live UI surfaces.
 *
 * HOW: Reads the summary from Supertry `/api/ai/allowance` using the current
 *      Bearer token. Successful summaries are cached in chrome.storage.local
 *      under `ai_allowance_summary` for cheap fan-out across extension views.
 *
 * NOT: Does not enforce limits locally. The server remains the only allowance
 *      authority; this service only mirrors summary state for UX.
 */

import { config } from '@/config/config';
import { Storage } from '@/utils/storage';
import { getAccessToken } from '@/utils/auth-state';

export interface AIAllowanceSummary {
    eligible: boolean;
    exhausted: boolean;
    percentUsed: number;
    periodStart: string | null;
    periodEnd: string | null;
    limitUsdMicros: number;
    usedUsdMicros: number;
    remainingUsdMicros: number;
}

interface AIAllowanceErrorPayload {
    error?: string;
    allowance?: AIAllowanceSummary;
}

const STORAGE_KEY = config.storage.keys.aiAllowanceSummary;

export function formatAllowancePercent(percentUsed: number): string {
    if (!Number.isFinite(percentUsed)) {
        return '0%';
    }

    return Number.isInteger(percentUsed)
        ? `${percentUsed}%`
        : `${percentUsed.toFixed(1)}%`;
}

function isAllowanceSummary(value: unknown): value is AIAllowanceSummary {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.eligible === 'boolean'
        && typeof candidate.exhausted === 'boolean'
        && typeof candidate.percentUsed === 'number'
        && typeof candidate.limitUsdMicros === 'number'
        && typeof candidate.usedUsdMicros === 'number'
        && typeof candidate.remainingUsdMicros === 'number';
}

export class AIAllowanceService {
    static async getSummary(): Promise<AIAllowanceSummary | null> {
        const stored = await Storage.get<AIAllowanceSummary>(STORAGE_KEY);
        return stored ?? null;
    }

    static async refresh(): Promise<AIAllowanceSummary | null> {
        const token = await getAccessToken();
        if (!token) {
            await this.clear();
            return null;
        }

        try {
            const response = await fetch(`${config.supertry.apiUrl}${config.ai.allowanceEndpoint}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                signal: AbortSignal.timeout(10_000),
            });

            if (response.status === 401) {
                await this.clear();
                return null;
            }

            if (!response.ok) {
                return this.getSummary();
            }

            const data = await response.json();
            if (!isAllowanceSummary(data)) {
                return this.getSummary();
            }

            await Storage.set(STORAGE_KEY, data);
            return data;
        } catch (error) {
            console.warn('[BlueTab][AIAllowance] refresh failed:', error);
            return this.getSummary();
        }
    }

    static async clear(): Promise<void> {
        await Storage.remove(STORAGE_KEY).catch(() => {});
    }

    static subscribeToSummary(callback: (summary: AIAllowanceSummary | null) => void): () => void {
        this.getSummary().then(callback).catch(() => callback(null));

        const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
            if (changes[STORAGE_KEY]) {
                const nextValue = changes[STORAGE_KEY].newValue;
                callback(isAllowanceSummary(nextValue) ? nextValue : null);
            }
        };

        chrome.storage.local.onChanged.addListener(listener);
        return () => {
            chrome.storage.local.onChanged.removeListener(listener);
        };
    }

    /**
     * @param options.refreshOnSuccess  Set false for streaming chat: a 200 only
     *   means the stream started, usage is not final yet, and the caller
     *   refreshes once when the turn finishes.
     */
    static async syncFromAIResponse(
        response: Response,
        options: { refreshOnSuccess?: boolean } = {},
    ): Promise<void> {
        if (response.ok) {
            if (options.refreshOnSuccess !== false) await this.refresh();
            return;
        }

        if (response.status !== 429) {
            return;
        }

        const payload = await response.clone().json().catch(() => null) as AIAllowanceErrorPayload | null;
        if (payload?.error !== 'token_cap_exceeded') {
            return;
        }

        if (isAllowanceSummary(payload.allowance)) {
            await Storage.set(STORAGE_KEY, payload.allowance);
            return;
        }

        await this.refresh();
    }
}
