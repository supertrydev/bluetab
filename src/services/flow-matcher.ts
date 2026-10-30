// SYNC NOTE: Logic mirrors FlowService.matchesRule/matchesCondition in src/services/flow-service.ts. If either changes, update this file too.

/**
 * flow-matcher.ts — Pure flow rule matching functions (DESIGN-04)
 *
 * WHY: The Flow Proposal Modal needs to dry-run proposed rules against open tabs
 *      without importing FlowService (which has async storage dependencies).
 * WHAT: Exports testRule() and matchesCondition() as pure, side-effect-free functions.
 * HOW:  Logic copied verbatim from FlowService.matchesRule/matchesCondition.
 *       DO NOT import FlowService here — circular-dep risk + unnecessary coupling.
 * NOT:  Does NOT remove or replace the existing static methods on FlowService.
 *       FlowService.processTab continues to use its own static methods internally.
 */

import type { FlowRule, FlowCondition } from '../types/flow';
import { makeSafeUserRegex } from '../utils/safe-regex';

/**
 * Test whether a single tab matches a FlowRule.
 * Pure function — no storage reads, no side effects, no async.
 * Used by FlowProposalModal for DESIGN-04 dry-run preview.
 *
 * @param rule    The FlowRule to test against
 * @param tab     The tab to match (url required, title optional)
 * @returns       true if the tab matches the rule's conditions
 */
export function testRule(rule: FlowRule, tab: { url: string; title?: string }): boolean {
    if (rule.conditions.length === 0) return false;

    const operator = rule.conditionOperator || 'AND';

    if (operator === 'OR') {
        // At least one condition must match
        return rule.conditions.some(condition => matchesCondition(tab.url, tab.title ?? '', condition));
    } else {
        // All conditions must match (AND logic - default)
        return rule.conditions.every(condition => matchesCondition(tab.url, tab.title ?? '', condition));
    }
}

/**
 * Check if a URL/title matches a single condition.
 * Supports negate flag (NOT operator).
 * Pure function — no storage reads, no side effects.
 *
 * Copied verbatim from FlowService.matchesCondition (src/services/flow-service.ts lines 367-461).
 *
 * @param url        The full tab URL
 * @param title      The tab title
 * @param condition  The FlowCondition to evaluate
 * @returns          true if the URL/title matches the condition (after applying negate)
 */
export function matchesCondition(url: string, title: string, condition: FlowCondition): boolean {
    let result = false;

    try {
        const parsedUrl = new URL(url);
        const testValue = condition.caseSensitive ? condition.value : condition.value.toLowerCase();

        switch (condition.type) {
            case 'url_contains': {
                const testUrl = condition.caseSensitive ? url : url.toLowerCase();
                result = testUrl.includes(testValue);
                break;
            }

            case 'url_starts_with': {
                const testUrl = condition.caseSensitive ? url : url.toLowerCase();
                result = testUrl.startsWith(testValue);
                break;
            }

            case 'url_matches_regex': {
                try {
                    const flags = condition.caseSensitive ? '' : 'i';
                    const regex = makeSafeUserRegex(condition.value, flags);
                    if (!regex) throw new Error('Unsafe regex');
                    result = regex.test(url);
                } catch {
                    console.warn('[BlueTab][FlowMatcher] Invalid regex:', condition.value);
                    result = false;
                }
                break;
            }

            case 'domain_equals': {
                const domain = parsedUrl.hostname.toLowerCase();
                const testDomain = testValue.toLowerCase();
                // Handle www prefix
                const normalizedDomain = domain.replace(/^www\./, '');
                const normalizedTest = testDomain.replace(/^www\./, '');
                result = normalizedDomain === normalizedTest;
                break;
            }

            case 'domain_contains': {
                // Secure domain matching:
                // - "youtube.com" matches: youtube.com, www.youtube.com, m.youtube.com
                // - "youtube.com" does NOT match: fakeyoutube.com, youtube.malicious.com
                const domain = parsedUrl.hostname.toLowerCase();
                const searchDomain = testValue.toLowerCase().replace(/^www\./, '');

                // Domain must either:
                // 1. Equal the search domain exactly (youtube.com === youtube.com)
                // 2. End with .searchDomain (m.youtube.com ends with .youtube.com)
                const normalizedDomain = domain.replace(/^www\./, '');
                result = normalizedDomain === searchDomain ||
                         normalizedDomain.endsWith('.' + searchDomain);
                break;
            }

            case 'path_contains': {
                const path = condition.caseSensitive ? parsedUrl.pathname : parsedUrl.pathname.toLowerCase();
                result = path.includes(testValue);
                break;
            }

            case 'title_contains': {
                const testTitle = condition.caseSensitive ? title : title.toLowerCase();
                result = testTitle.includes(testValue);
                break;
            }

            case 'title_matches_regex': {
                try {
                    const flags = condition.caseSensitive ? '' : 'i';
                    const regex = makeSafeUserRegex(condition.value, flags);
                    if (!regex) throw new Error('Unsafe regex');
                    result = regex.test(title);
                } catch {
                    console.warn('[BlueTab][FlowMatcher] Invalid regex:', condition.value);
                    result = false;
                }
                break;
            }

            default:
                console.warn('[BlueTab][FlowMatcher] Unknown condition type:', condition.type);
                result = false;
        }
    } catch (_error) {
        // Invalid URL
        console.warn('[BlueTab][FlowMatcher] Invalid URL:', url);
        result = false;
    }

    // Apply negate (NOT) operator
    return condition.negate ? !result : result;
}
