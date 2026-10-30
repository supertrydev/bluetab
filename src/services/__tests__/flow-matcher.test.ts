/**
 * Tests for flow-matcher.ts (DESIGN-04)
 *
 * Verifies testRule() and matchesCondition() pure functions cover all 8
 * FlowConditionTypes, AND/OR operators, negate flag, and case-insensitive default.
 */

import { testRule, matchesCondition } from '../flow-matcher';
import type { FlowRule, FlowCondition } from '../../types/flow';

function makeRule(overrides: Partial<FlowRule> = {}): FlowRule {
  return {
    id: 'r1',
    name: 'Test Rule',
    enabled: true,
    priority: 1,
    conditions: [],
    action: { type: 'create_group', newGroupName: 'Test' },
    created: 1000,
    modified: 1000,
    ...overrides,
  };
}

function makeCond(type: FlowCondition['type'], value: string, extras: Partial<FlowCondition> = {}): FlowCondition {
  return { id: 'c1', type, value, ...extras };
}

describe('testRule (DESIGN-04)', () => {
  it('returns false when conditions array is empty', () => {
    const rule = makeRule({ conditions: [] });
    expect(testRule(rule, { url: 'https://example.com', title: 'Example' })).toBe(false);
  });

  it('AND operator: returns true when all conditions match', () => {
    const rule = makeRule({
      conditionOperator: 'AND',
      conditions: [
        makeCond('domain_equals', 'youtube.com'),
        makeCond('url_contains', 'watch'),
      ],
    });
    expect(testRule(rule, { url: 'https://www.youtube.com/watch?v=abc', title: '' })).toBe(true);
  });

  it('AND operator: returns false when any condition fails', () => {
    const rule = makeRule({
      conditionOperator: 'AND',
      conditions: [
        makeCond('domain_equals', 'youtube.com'),
        makeCond('url_contains', 'playlist'),
      ],
    });
    expect(testRule(rule, { url: 'https://www.youtube.com/watch?v=abc', title: '' })).toBe(false);
  });

  it('OR operator: returns true when at least one condition matches', () => {
    const rule = makeRule({
      conditionOperator: 'OR',
      conditions: [
        makeCond('domain_equals', 'github.com'),
        makeCond('domain_equals', 'gitlab.com'),
      ],
    });
    expect(testRule(rule, { url: 'https://github.com/user/repo', title: '' })).toBe(true);
  });

  it('OR operator: returns false when no conditions match', () => {
    const rule = makeRule({
      conditionOperator: 'OR',
      conditions: [
        makeCond('domain_equals', 'github.com'),
        makeCond('domain_equals', 'gitlab.com'),
      ],
    });
    expect(testRule(rule, { url: 'https://bitbucket.org/user/repo', title: '' })).toBe(false);
  });

  it('defaults to AND when conditionOperator is undefined', () => {
    const rule = makeRule({
      conditions: [
        makeCond('domain_equals', 'github.com'),
        makeCond('url_contains', 'issues'),
      ],
    });
    expect(testRule(rule, { url: 'https://github.com/user/repo/issues', title: '' })).toBe(true);
  });
});

describe('matchesCondition — all 8 condition types', () => {
  it('url_contains: matches substring in URL (case-insensitive default)', () => {
    const cond = makeCond('url_contains', 'GITHUB');
    expect(matchesCondition('https://github.com/repo', '', cond)).toBe(true);
  });

  it('url_starts_with: matches URL prefix', () => {
    const cond = makeCond('url_starts_with', 'https://docs.');
    expect(matchesCondition('https://docs.google.com', '', cond)).toBe(true);
  });

  it('url_starts_with: returns false when prefix does not match', () => {
    const cond = makeCond('url_starts_with', 'https://docs.');
    expect(matchesCondition('https://www.google.com', '', cond)).toBe(false);
  });

  it('url_matches_regex: matches regex on full URL', () => {
    const cond = makeCond('url_matches_regex', 'github\\.com/[^/]+/issues');
    expect(matchesCondition('https://github.com/user/issues', '', cond)).toBe(true);
  });

  it('url_matches_regex: returns false for non-matching regex', () => {
    const cond = makeCond('url_matches_regex', '^https://api\\.');
    expect(matchesCondition('https://www.example.com', '', cond)).toBe(false);
  });

  it('domain_equals: matches domain stripping www prefix', () => {
    const cond = makeCond('domain_equals', 'youtube.com');
    expect(matchesCondition('https://www.youtube.com/watch', '', cond)).toBe(true);
  });

  it('domain_equals: returns false for different domain', () => {
    const cond = makeCond('domain_equals', 'youtube.com');
    expect(matchesCondition('https://vimeo.com/video', '', cond)).toBe(false);
  });

  it('domain_contains: matches subdomain relationship', () => {
    const cond = makeCond('domain_contains', 'google.com');
    expect(matchesCondition('https://docs.google.com/doc', '', cond)).toBe(true);
  });

  it('domain_contains: does not match unrelated domain containing the substring in path', () => {
    const cond = makeCond('domain_contains', 'google.com');
    expect(matchesCondition('https://fakegoogle.com', '', cond)).toBe(false);
  });

  it('path_contains: matches substring in URL path', () => {
    const cond = makeCond('path_contains', '/issues');
    expect(matchesCondition('https://github.com/user/repo/issues/1', '', cond)).toBe(true);
  });

  it('path_contains: returns false when path does not contain substring', () => {
    const cond = makeCond('path_contains', '/issues');
    expect(matchesCondition('https://github.com/user/repo/pulls', '', cond)).toBe(false);
  });

  it('title_contains: matches substring in tab title', () => {
    const cond = makeCond('title_contains', 'GitHub');
    expect(matchesCondition('https://github.com', 'GitHub - Repo', cond)).toBe(true);
  });

  it('title_contains: case-insensitive by default', () => {
    const cond = makeCond('title_contains', 'github');
    expect(matchesCondition('https://github.com', 'GitHub - Repo', cond)).toBe(true);
  });

  it('title_matches_regex: matches regex on tab title', () => {
    const cond = makeCond('title_matches_regex', '^YouTube');
    expect(matchesCondition('https://youtube.com', 'YouTube - Video', cond)).toBe(true);
  });

  it('title_matches_regex: returns false for non-matching regex', () => {
    const cond = makeCond('title_matches_regex', '^GitHub');
    expect(matchesCondition('https://youtube.com', 'YouTube - Video', cond)).toBe(false);
  });
});

describe('matchesCondition — negate flag', () => {
  it('negate: true inverts a match (domain_equals)', () => {
    const cond = makeCond('domain_equals', 'youtube.com', { negate: true });
    // youtube.com would normally match — negated it should return false
    expect(matchesCondition('https://www.youtube.com', '', cond)).toBe(false);
  });

  it('negate: true inverts a non-match (domain_equals)', () => {
    const cond = makeCond('domain_equals', 'youtube.com', { negate: true });
    // vimeo.com does NOT match — negated it should return true
    expect(matchesCondition('https://vimeo.com', '', cond)).toBe(true);
  });
});

describe('matchesCondition — case sensitivity', () => {
  it('caseSensitive: false (default) treats strings as lowercase', () => {
    const cond = makeCond('url_contains', 'GITHUB', { caseSensitive: false });
    expect(matchesCondition('https://github.com', '', cond)).toBe(true);
  });

  it('caseSensitive: true does exact-case matching', () => {
    const condUpper = makeCond('url_contains', 'GITHUB', { caseSensitive: true });
    const condLower = makeCond('url_contains', 'github', { caseSensitive: true });
    // URL is lowercase — uppercase should not match, lowercase should
    expect(matchesCondition('https://github.com', '', condUpper)).toBe(false);
    expect(matchesCondition('https://github.com', '', condLower)).toBe(true);
  });
});
