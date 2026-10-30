/**
 * @module services/ai-flow-focus-tools
 *
 * WHY:  Users asked the AI chat to "always put GitHub tabs into Dev" or
 *       "block youtube.com", but the chat had no tool for either. The model
 *       fell back to update_settings, whose focusCustomDomains write replaces
 *       the whole blocklist.
 *
 * WHAT: Executors for the `create_flow_rule` and `block_site` AI tools.
 *       Inputs come from the LLM, so every field is validated before it is
 *       written. Results are small JSON objects the model can summarise.
 *
 * HOW:  Flow rules go through FlowStorageService.createRule after a
 *       FlowRuleSchema check. Domains are normalised and merged through
 *       FocusService.addCustomDomains; the service worker's storage listener
 *       refreshes the block rules when Focus Mode is active.
 *
 * NOT:  Does not request host permissions (that needs a user gesture in a
 *       settings page). Flow and Focus Mode are switched on automatically,
 *       because asking for a rule or a block means the user wants it active.
 */

import {
    FlowActionTypeSchema,
    FlowConditionSchema,
    FlowConditionTypeSchema,
    FlowRuleSchema,
    type FlowAction,
    type FlowCondition,
} from '@/types/flow';
import { FlowStorageService } from '@/utils/flow-storage';
import { normalizeFocusDomain } from '@/utils/focus-domain';
import { Storage } from '@/utils/storage';
import { normalizeFocusSettings } from '@/config/focus-presets';
import type { FocusSettings } from '@/types/productivity';

export type AIToolArgs = Record<string, unknown>;

const MAX_CONDITIONS = 10;
const MAX_DOMAINS = 50;

function asTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** Regex conditions from the LLM must compile, or the rule would never match. */
function isUsableCondition(condition: FlowCondition): boolean {
    if (!condition.value) return false;
    if (condition.type === 'url_matches_regex' || condition.type === 'title_matches_regex') {
        try {
            new RegExp(condition.value);
        } catch {
            return false;
        }
    }
    return true;
}

const CONDITION_TYPE_ALIASES: Record<string, FlowCondition['type']> = {
    domain: 'domain_contains',
    site: 'domain_contains',
    host: 'domain_contains',
    hostname: 'domain_contains',
    url: 'url_contains',
    path: 'path_contains',
    title: 'title_contains',
    regex: 'url_matches_regex',
};

function normalizeConditionType(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const key = value.trim().toLowerCase();
    return CONDITION_TYPE_ALIASES[key] ?? key;
}

/** conditions as an array, a JSON string, a single object, or flat domain/value fields. */
function readConditions(args: AIToolArgs): Array<Record<string, unknown>> {
    let raw: unknown = args.conditions ?? args.condition;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            raw = undefined;
        }
    }
    if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = [raw];
    if (Array.isArray(raw)) {
        return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    }
    const domain = asTrimmedString(args.domain ?? args.site);
    return domain ? [{ type: 'domain_contains', value: domain }] : [];
}

export async function createFlowRuleFromAI(args: AIToolArgs) {
    // Models do not always follow the schema exactly; accept the common
    // variants instead of failing the user's request.
    const rawConditions = readConditions(args).slice(0, MAX_CONDITIONS);
    if (rawConditions.length === 0) {
        return { status: 'error', message: 'At least one condition is required, e.g. [{"type":"domain_contains","value":"github.com"}].' };
    }

    const conditions: FlowCondition[] = [];
    rawConditions.forEach((candidate, index) => {
        const parsed = FlowConditionSchema.safeParse({
            id: `cond-${Date.now()}-${index}`,
            type: normalizeConditionType(candidate.type ?? candidate.field ?? candidate.match),
            value: asTrimmedString(candidate.value ?? candidate.pattern ?? candidate.text),
            negate: candidate.negate === true || candidate.not === true ? true : undefined,
        });
        if (parsed.success && isUsableCondition(parsed.data)) conditions.push(parsed.data);
    });
    if (conditions.length === 0) {
        return {
            status: 'error',
            message: `None of the conditions were valid. type must be one of ${FlowConditionTypeSchema.options.join(', ')} and value must not be empty.`,
        };
    }

    const nestedAction = args.action && typeof args.action === 'object' ? args.action as Record<string, unknown> : {};
    const targetGroupId = asTrimmedString(args.targetGroupId ?? nestedAction.targetGroupId);
    const groupName = asTrimmedString(
        args.groupName ?? args.newGroupName ?? args.targetGroupName ?? args.group
            ?? nestedAction.newGroupName ?? nestedAction.groupName,
    );
    const requestedType = args.actionType ?? nestedAction.type ?? (targetGroupId && !groupName ? 'add_to_existing_group' : 'add_to_or_create');
    const actionType = FlowActionTypeSchema.safeParse(requestedType);
    if (!actionType.success) {
        return { status: 'error', message: `actionType must be one of ${FlowActionTypeSchema.options.join(', ')}.` };
    }

    const name = asTrimmedString(args.name ?? args.ruleName)
        || (groupName ? `${conditions[0].value} \u2192 ${groupName}` : conditions[0].value);

    const action: FlowAction = { type: actionType.data };
    if (actionType.data === 'add_to_existing_group') {
        if (!targetGroupId) return { status: 'error', message: 'targetGroupId is required for add_to_existing_group. Use add_to_or_create with groupName instead.' };
        action.targetGroupId = targetGroupId;
    } else {
        // A rule without a target would match tabs and do nothing; fall back to the rule name.
        action.newGroupName = groupName || name;
    }

    const settings = await FlowStorageService.getFlowSettings();
    const duplicate = settings.rules.find((rule) => rule.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
        return { status: 'exists', ruleId: duplicate.id, name: duplicate.name, message: 'A Flow rule with this name already exists.' };
    }

    const now = Date.now();
    const ruleData = {
        name,
        enabled: true,
        // Lower runs first; append after the user's own rules.
        priority: settings.rules.reduce((max, rule) => Math.max(max, rule.priority), -1) + 1,
        conditions,
        conditionOperator: args.conditionOperator === 'OR' ? 'OR' as const : 'AND' as const,
        action,
    };
    const validated = FlowRuleSchema.safeParse({ ...ruleData, id: 'pending', created: now, modified: now });
    if (!validated.success) return { status: 'error', message: 'The rule did not pass validation.' };

    const result = await FlowStorageService.createRule(ruleData);
    if (!result.success) return { status: 'error', message: result.error ?? 'Failed to save the rule.' };

    // Asking for a rule means the user wants Flow running; switch it on quietly.
    if (!settings.enabled) await FlowStorageService.toggleFlow(true);

    return {
        status: 'success',
        ruleId: result.ruleId,
        name,
        conditionCount: conditions.length,
        skippedConditions: rawConditions.length - conditions.length,
        note: 'The rule applies the next time tabs are saved.',
    };
}

/** Ask the service worker to turn Focus Mode on (idempotent, unlike TOGGLE_FOCUS). */
function requestFocusOn(): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: 'ENABLE_FOCUS' }, (response?: { success?: boolean }) => {
                void chrome.runtime.lastError;
                resolve(response?.success === true);
            });
        } catch {
            resolve(false);
        }
    });
}

export async function blockSitesFromAI(args: AIToolArgs) {
    const raw = Array.isArray(args.domains) ? args.domains.slice(0, MAX_DOMAINS) : [];
    const domains = Array.from(new Set(
        raw
            .map((value) => (typeof value === 'string' ? normalizeFocusDomain(value) : null))
            .filter((value): value is string => Boolean(value)),
    ));
    if (domains.length === 0) {
        return { status: 'error', message: 'No valid domains. Use bare domains such as "youtube.com".' };
    }

    // focus-service pulls in stats/ADHD services; load it only when the tool runs.
    const [{ FocusService }, { hasFocusSiteAccess }] = await Promise.all([
        import('@/services/focus-service'),
        import('@/services/focus-site-access'),
    ]);

    const before = normalizeFocusSettings(await Storage.get<FocusSettings>('focusSettings'));
    const alreadyBlocked = domains.filter((domain) => before.customDomains.includes(domain));
    const added = domains.filter((domain) => !before.customDomains.includes(domain));

    // One write: merge the domains and switch the Focus master toggle on.
    if (added.length > 0 || !before.enabled) {
        await Storage.set('focusSettings', {
            ...before,
            enabled: true,
            customDomains: Array.from(new Set([...before.customDomains, ...added])).sort(),
        });
    }

    const state = await FocusService.getState();
    const focusActive = state.isActive || await requestFocusOn();
    const siteAccess = await hasFocusSiteAccess();

    return {
        status: 'success',
        added,
        alreadyBlocked,
        focusActive,
        siteAccessGranted: siteAccess,
        // Site access needs a click in Settings; it is the one thing the AI cannot do itself.
        note: siteAccess ? undefined : 'Site access is not granted yet; turn it on in Settings > Focus so blocking can work.',
    };
}
