/**
 * @module utils/ai-settings-write
 *
 * WHY:  The AI `update_settings write` tool merged any key/value the model
 *       sent straight into storage. A wrong guess ("theme": "blue", a typo'd
 *       key, an object where a boolean belongs) was saved as-is and could
 *       break a settings screen.
 *
 * WHAT: Validates a write request against an explicit allowlist with types,
 *       enums and numeric ranges, and routes each accepted key to its store
 *       (general / pomodoro / focus / ai). Rejected keys come back with a
 *       reason so the model can tell the user or retry.
 *
 * NOT:  Does not touch storage; useAIChat applies the returned patches.
 */

import { normalizeFocusDomain } from '@/utils/focus-domain';
import { AUTO_ARCHIVE_DAY_OPTIONS } from '@/config/auto-archive';

type Rule =
    | { kind: 'boolean' }
    | { kind: 'enum'; values: readonly string[] }
    | { kind: 'number'; min: number; max: number; integer?: boolean; oneOf?: readonly number[] };

const bool: Rule = { kind: 'boolean' };
const oneOf = (...values: string[]): Rule => ({ kind: 'enum', values });

/** Settings (key `settings`) the AI may change. Objects like groupMenuConfig are excluded. */
const GENERAL_RULES: Record<string, Rule> = {
    theme: oneOf('light', 'dark', 'system'),
    language: oneOf('system', 'en', 'tr', 'es', 'pt-BR', 'id', 'ar'),
    sortOrder: oneOf('newest', 'oldest', 'alphabetical', 'mostTabs', 'leastTabs'),
    restoreMode: oneOf('smart', 'newWindow', 'currentWindow'),
    pinnedTabsMode: oneOf('exclude', 'include'),
    startupBehavior: oneOf('show', 'manual'),
    restoreBehavior: oneOf('removeFromList', 'keepInList'),
    duplicateHandling: oneOf('allow', 'reject'),
    tabGroupRestoreMode: oneOf('normal', 'browserGroups'),
    floatingButtonPosition: oneOf('top-right', 'top-left', 'bottom-right', 'bottom-left'),
    tabUrlDisplay: oneOf('full', 'hostname'),
    groupNotesDisplay: oneOf('full', 'preview'),
    maxGroups: { kind: 'number', min: 1, max: 10000, integer: true },
    contextMenuGroupLimit: { kind: 'number', min: 1, max: 100, integer: true },
    autoArchiveInactiveDays: { kind: 'number', min: 1, max: 365, integer: true, oneOf: AUTO_ARCHIVE_DAY_OPTIONS },
    customNewTabEnabled: bool,
    autoArchiveInactiveGroups: bool,
    groupMemoryEnabled: bool,
    groupMemoryAutoRemember: bool,
    openManagerAfterSave: bool,
    floatingButtonEnabled: bool,
    floatingButtonConfirmSaveAll: bool,
    browserTabsGroupBorder: bool,
    browserTabsCloseOnSave: bool,
    browserTabsShowInactiveIndicator: bool,
};

/** pomodoroSettings; the `pomodoro` prefix the prompt uses is accepted as an alias. */
const POMODORO_RULES: Record<string, Rule> = {
    preset: oneOf('classic', 'short', 'deepWork', 'custom'),
    customWork: { kind: 'number', min: 1, max: 180, integer: true },
    customShortBreak: { kind: 'number', min: 1, max: 60, integer: true },
    customLongBreak: { kind: 'number', min: 1, max: 120, integer: true },
    longBreakInterval: { kind: 'number', min: 1, max: 12, integer: true },
};
const POMODORO_ALIASES: Record<string, string> = {
    pomodoroPreset: 'preset',
    pomodoroCustomWork: 'customWork',
    pomodoroCustomShortBreak: 'customShortBreak',
    pomodoroCustomLongBreak: 'customLongBreak',
    pomodoroLongBreakInterval: 'longBreakInterval',
};

const FOCUS_ALIASES: Record<string, string> = {
    focusEnabled: 'enabled',
    focusPresets: 'presets',
    focusCustomDomains: 'customDomains',
    focusBlockDuringBreaks: 'blockDuringBreaks',
    focusAutoEnableWithPomodoro: 'autoEnableWithPomodoro',
};
const FOCUS_BOOLEAN_KEYS = new Set(['enabled', 'blockDuringBreaks', 'autoEnableWithPomodoro']);
const FOCUS_PRESET_KEYS = new Set(['socialMedia', 'newsMedia', 'entertainment', 'shopping']);

const AI_RULES: Record<string, Rule> = { smartNaming: bool };

export interface SettingsWritePlan {
    general: Record<string, unknown>;
    pomodoro: Record<string, unknown>;
    /** `presets` is partial; merge it over the stored presets. */
    focus: Record<string, unknown>;
    ai: Record<string, unknown>;
    applied: string[];
    rejected: Array<{ key: string; reason: string }>;
}

function check(rule: Rule, value: unknown): string | null {
    if (rule.kind === 'boolean') return typeof value === 'boolean' ? null : 'expected true or false';
    if (rule.kind === 'enum') {
        return typeof value === 'string' && rule.values.includes(value)
            ? null
            : `expected one of: ${rule.values.join(', ')}`;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected a number';
    if (rule.integer && !Number.isInteger(value)) return 'expected a whole number';
    if (rule.oneOf && !rule.oneOf.includes(value)) return `expected one of: ${rule.oneOf.join(', ')}`;
    if (value < rule.min || value > rule.max) return `expected ${rule.min}-${rule.max}`;
    return null;
}

export function planSettingsWrite(input: Record<string, unknown>): SettingsWritePlan {
    const plan: SettingsWritePlan = { general: {}, pomodoro: {}, focus: {}, ai: {}, applied: [], rejected: [] };
    const reject = (key: string, reason: string) => plan.rejected.push({ key, reason });

    for (const [key, value] of Object.entries(input)) {
        // Pomodoro
        const pomodoroKey = POMODORO_ALIASES[key] ?? (key in POMODORO_RULES ? key : null);
        if (pomodoroKey) {
            const problem = check(POMODORO_RULES[pomodoroKey], value);
            if (problem) reject(key, problem);
            else {
                plan.pomodoro[pomodoroKey] = value;
                plan.applied.push(key);
            }
            continue;
        }

        // Focus
        const focusKey = FOCUS_ALIASES[key] ?? (FOCUS_BOOLEAN_KEYS.has(key) || key === 'presets' || key === 'customDomains' ? key : null);
        if (focusKey) {
            if (FOCUS_BOOLEAN_KEYS.has(focusKey)) {
                if (typeof value !== 'boolean') reject(key, 'expected true or false');
                else {
                    plan.focus[focusKey] = value;
                    plan.applied.push(key);
                }
            } else if (focusKey === 'presets') {
                const entries = value && typeof value === 'object' && !Array.isArray(value)
                    ? Object.entries(value as Record<string, unknown>)
                    : null;
                const valid = entries?.filter(([preset, on]) => FOCUS_PRESET_KEYS.has(preset) && typeof on === 'boolean');
                if (!valid || valid.length === 0) {
                    reject(key, 'expected { socialMedia | newsMedia | entertainment | shopping: boolean }');
                } else {
                    plan.focus.presets = Object.fromEntries(valid);
                    plan.applied.push(key);
                }
            } else {
                // customDomains replaces the list (used for removals); additions should use block_site.
                if (!Array.isArray(value)) reject(key, 'expected a list of domains');
                else {
                    const domains = Array.from(new Set(
                        value.map((entry) => (typeof entry === 'string' ? normalizeFocusDomain(entry) : null))
                            .filter((entry): entry is string => Boolean(entry)),
                    )).sort();
                    if (value.length > 0 && domains.length === 0) {
                        reject(key, 'no valid domains');
                    } else {
                        plan.focus.customDomains = domains;
                        plan.applied.push(key);
                    }
                }
            }
            continue;
        }

        // AI
        if (key in AI_RULES) {
            const problem = check(AI_RULES[key], value);
            if (problem) reject(key, problem);
            else {
                plan.ai[key] = value;
                plan.applied.push(key);
            }
            continue;
        }

        // General
        if (key in GENERAL_RULES) {
            const problem = check(GENERAL_RULES[key], value);
            if (problem) reject(key, problem);
            else {
                plan.general[key] = value;
                plan.applied.push(key);
            }
            continue;
        }

        reject(key, 'unknown or read-only setting');
    }

    return plan;
}
