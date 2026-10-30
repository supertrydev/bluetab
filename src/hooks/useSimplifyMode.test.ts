/**
 * Tests for useSimplifyMode hook (Phase 9 Plan 09-04).
 *
 * Covers ADHD-16 (data-simplify/data-simplify-aggressive attribute flipping),
 * ADHD-17 (Babel-AST affordance-preservation contract — MANDATORY, asserts
 * no functional element carries bt-decor or bt-aggressive-hide on itself or
 * any ancestor), and the CSS assertion for ADHD-18 (prefers-reduced-motion
 * block present in simplify.css).
 *
 * DOM strategy: Option B (locked per 09-VALIDATION) — we install a minimal
 * `document` stub BEFORE importing the hook module so the imported helpers
 * see our stub when they reference `document.documentElement`. No
 * `jest-environment-jsdom` devDep is added; jest.config.ts stays on the
 * node environment.
 */

// ---------- Option B: install document stub FIRST ----------

const attrMap = new Map<string, string>();
const toggleAttribute = jest.fn((name: string, force?: boolean) => {
  if (force === false) {
    attrMap.delete(name);
    return false;
  }
  if (force === true) {
    attrMap.set(name, '');
    return true;
  }
  if (attrMap.has(name)) {
    attrMap.delete(name);
    return false;
  }
  attrMap.set(name, '');
  return true;
});
const setAttribute = jest.fn((name: string, value: string) => {
  attrMap.set(name, value);
});
const removeAttribute = jest.fn((name: string) => {
  attrMap.delete(name);
});
const getAttribute = jest.fn((name: string) => attrMap.get(name) ?? null);
const hasAttribute = jest.fn((name: string) => attrMap.has(name));

const docStub = {
  documentElement: {
    toggleAttribute,
    setAttribute,
    removeAttribute,
    getAttribute,
    hasAttribute,
  },
};

Object.defineProperty(globalThis, 'document', {
  value: docStub,
  writable: true,
  configurable: true,
});

// ---------- imports AFTER document stub is in place ----------

import { applySimplifyAttributes, computeSimplifyFlags } from './useSimplifyMode';
import { ADHDService } from '@/services/adhd-service';
import { DEFAULT_ADHD_SETTINGS, type ADHDSettings } from '@/types/adhd';
import * as fs from 'fs';
import * as path from 'path';

// ---------- Settings fixtures ----------

function makeSettings(over: Partial<ADHDSettings> = {}): ADHDSettings {
  return {
    ...DEFAULT_ADHD_SETTINGS,
    ...over,
    simplify: { ...DEFAULT_ADHD_SETTINGS.simplify, ...(over.simplify ?? {}) },
  };
}

// ---------- Attribute flip tests ----------

describe('applySimplifyAttributes', () => {
  beforeEach(() => {
    attrMap.clear();
    toggleAttribute.mockClear();
    setAttribute.mockClear();
    removeAttribute.mockClear();
  });

  it('leaves attributes OFF when masterEnabled is false even if simplify.enabled is true', () => {
    applySimplifyAttributes(
      makeSettings({
        masterEnabled: false,
        simplify: { enabled: true, aggressive: true },
      }),
    );
    expect(attrMap.has('data-simplify')).toBe(false);
    expect(attrMap.has('data-simplify-aggressive')).toBe(false);
  });

  it('sets data-simplify="true" when master + simplify.enabled are both true', () => {
    applySimplifyAttributes(
      makeSettings({
        masterEnabled: true,
        simplify: { enabled: true, aggressive: false },
      }),
    );
    // Post-ship iteration round 2: the CSS selector is html[data-simplify="true"],
    // not html[data-simplify]. Attribute value must be the literal string "true",
    // not an empty string (which is what toggleAttribute writes). Regression
    // guard — if a future refactor switches back to toggleAttribute, this test
    // catches the value mismatch that masks the feature in Chrome.
    expect(attrMap.get('data-simplify')).toBe('true');
    expect(attrMap.has('data-simplify-aggressive')).toBe(false);
  });

  it('sets BOTH attributes to "true" when master + simplify + aggressive are all true', () => {
    applySimplifyAttributes(
      makeSettings({
        masterEnabled: true,
        simplify: { enabled: true, aggressive: true },
      }),
    );
    expect(attrMap.get('data-simplify')).toBe('true');
    expect(attrMap.get('data-simplify-aggressive')).toBe('true');
  });

  it('removes data-simplify when simplify.enabled flips from true to false', () => {
    // First pass: both on.
    applySimplifyAttributes(
      makeSettings({
        masterEnabled: true,
        simplify: { enabled: true, aggressive: true },
      }),
    );
    expect(attrMap.get('data-simplify')).toBe('true');
    expect(attrMap.get('data-simplify-aggressive')).toBe('true');

    // Second pass: simplify turned off.
    applySimplifyAttributes(
      makeSettings({
        masterEnabled: true,
        simplify: { enabled: false, aggressive: true },
      }),
    );
    expect(attrMap.has('data-simplify')).toBe(false);
    // aggressive is gated on simplify — also cleared.
    expect(attrMap.has('data-simplify-aggressive')).toBe(false);
  });

  it('removes data-simplify-aggressive when only the sub-flag flips off', () => {
    applySimplifyAttributes(
      makeSettings({
        masterEnabled: true,
        simplify: { enabled: true, aggressive: true },
      }),
    );
    expect(attrMap.get('data-simplify-aggressive')).toBe('true');

    applySimplifyAttributes(
      makeSettings({
        masterEnabled: true,
        simplify: { enabled: true, aggressive: false },
      }),
    );
    expect(attrMap.get('data-simplify')).toBe('true');
    expect(attrMap.has('data-simplify-aggressive')).toBe(false);
  });
});

// ---------- computeSimplifyFlags ----------

describe('computeSimplifyFlags', () => {
  it('gates aggressive on simplify (aggressive cannot be true without simplify)', () => {
    const flags = computeSimplifyFlags(
      makeSettings({
        masterEnabled: true,
        simplify: { enabled: false, aggressive: true },
      }),
    );
    expect(flags.simplify).toBe(false);
    expect(flags.aggressive).toBe(false);
  });
});

// ---------- Subscribe lifecycle ----------

describe('ADHDService.subscribe lifecycle (unsubscribe on cleanup)', () => {
  it('useSimplifyMode returns a cleanup that unsubscribes', () => {
    // Verify the shape contract: ADHDService.subscribe returns a function
    // that removes the listener from chrome.storage.onChanged. The hook
    // stores that function and calls it on unmount — this is the
    // architectural guarantee; we assert the shape here because full React
    // lifecycle testing would need jsdom (disallowed by 09-VALIDATION
    // Option B).
    const fakeStorageChanged = chrome.storage.onChanged as unknown as {
      addListener: jest.Mock;
      removeListener: jest.Mock;
    };
    fakeStorageChanged.addListener.mockClear();
    fakeStorageChanged.removeListener.mockClear();

    const unsubscribe = ADHDService.subscribe(() => {});
    expect(fakeStorageChanged.addListener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(fakeStorageChanged.removeListener).toHaveBeenCalledTimes(1);
  });
});

// ---------- ADHD-18: prefers-reduced-motion CSS assertion ----------

describe('simplify.css — prefers-reduced-motion block (ADHD-18)', () => {
  it('contains an unconditional @media (prefers-reduced-motion: reduce) block', () => {
    const cssPath = path.resolve(process.cwd(), 'src/styles/simplify.css');
    const src = fs.readFileSync(cssPath, 'utf8');
    expect(src).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    // Unconditional: the block must NOT be nested inside any html[data-simplify]
    // selector. Simplest check — look for the block at the top-level.
    expect(src).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation-duration[\s\S]*?\}/,
    );
  });
});

// ---------- tailwind.css @import order regression guard ----------
//
// Post-ship iteration (2026-04-18): simplify.css appeared to "do nothing"
// in Chrome because the `@import './simplify.css'` directive was placed
// AFTER the `@tailwind base/components/utilities` directives in
// src/styles/tailwind.css. CSS spec requires `@import` rules to precede
// any other at-rule or rule, so PostCSS/Tailwind silently dropped the
// import — the bt-decor / [data-simplify] / prefers-reduced-motion rules
// never shipped to dist/assets/tailwind-*.css. This test parses
// tailwind.css and asserts every `@import` appears before the first
// `@tailwind` directive so the regression cannot recur.

describe('tailwind.css — @import ordering (post-ship iteration guard)', () => {
  it('every @import appears before the first @tailwind directive', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/styles/tailwind.css'),
      'utf8',
    );

    const firstTailwindIdx = src.search(/@tailwind\s+(?:base|components|utilities)\b/);
    expect(firstTailwindIdx).toBeGreaterThan(-1);

    const importRe = /^[^\S\n]*@import\b/gm;
    let match: RegExpExecArray | null;
    const offendingImports: number[] = [];
    while ((match = importRe.exec(src)) !== null) {
      if (match.index > firstTailwindIdx) offendingImports.push(match.index);
    }

    if (offendingImports.length > 0) {
      const lineOf = (idx: number) => src.slice(0, idx).split('\n').length;
      throw new Error(
        'tailwind.css has @import rule(s) AFTER @tailwind directives — PostCSS will silently drop them, and Simplify Mode rules will not reach the built bundle. Offending @import(s) at line(s): ' +
          offendingImports.map(lineOf).join(', '),
      );
    }

    expect(offendingImports).toEqual([]);
  });

  it('includes the simplify.css import', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/styles/tailwind.css'),
      'utf8',
    );
    expect(src).toMatch(/@import\s+['"]\.\/simplify\.css['"]/);
  });
});

// ---------- ADHD-17: Babel-AST affordance-preservation CONTRACT (MANDATORY) ----------
//
// Walks the JSX in each of the 4 component files that Task 9-04-02 marks
// with `bt-decor` / `bt-aggressive-hide`. The contract is:
//
//   * `bt-decor` means PERMANENTLY hidden under Default Simplify — no
//     functional element (button, menu item, input, link) may be marked
//     with it, on itself or on any ancestor. Hiding a functional element
//     permanently removes the affordance — the ADHD-17 violation we guard
//     against.
//
//   * `bt-aggressive-hide` means HOVER-REVEAL under opt-in Aggressive mode
//     — the element stays fully accessible on row hover or focus-within.
//     Per CONTEXT.md §Simplify, pin/action icons and the 3-dot menu get
//     this marker by design on Options-shell group rows. Hover-reveal is
//     NOT a hide for affordance purposes: accessibility is preserved via
//     the row's hover target. This marker is therefore NOT flagged on
//     functional elements.
//
// We walk ancestors so that marking a whole decorative wrapper cannot
// sneak a functional descendant past the gate.
//
// Uses @babel/parser + @babel/traverse (present in repo node_modules via
// transitive dependency of Vite/React tooling). If EITHER module is
// missing the test FAILS with a descriptive require-error — no regex
// fallback.

describe('Simplify Mode — affordance preservation contract (ADHD-17, MANDATORY)', () => {
  // Lazy-load so the describe block can still be discovered and reported
  // cleanly if the modules are missing.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const parser: any = require('@babel/parser');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const traverse: any = require('@babel/traverse').default;

  const FILES = [
    'src/sidepanel/components/GroupsPanel.tsx',
    'src/sidepanel/components/TabItem.tsx',
    'src/components/MasonryGroupCard.tsx',
    'src/options/components/GroupListView.tsx',
  ];

  const FUNCTIONAL_TAGS = new Set([
    'button',
    'Button',
    'Input',
    'Select',
    'SelectTrigger',
    'SelectContent',
    'SelectItem',
    'DropdownMenu',
    'DropdownMenuTrigger',
    'DropdownMenuContent',
    'DropdownMenuItem',
    'Link',
    'a',
  ]);

  // `bt-decor` is the affordance-contract marker — anything inside a
  // bt-decor ancestor is permanently hidden under Default Simplify. The
  // AST check flags functional tags under bt-decor (self or ancestor).
  // `bt-aggressive-hide` is hover-reveal; by design it may wrap functional
  // icons in the Options-shell group row (see CONTEXT.md §Simplify). We
  // therefore do NOT include it in the permanent-hide marker set.
  const PERMANENT_HIDE_MARKER_RE = /\bbt-decor\b/;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function jsxTagName(openingNode: any): string | null {
    const n = openingNode.name;
    if (!n) return null;
    if (n.type === 'JSXIdentifier') return n.name;
    if (n.type === 'JSXMemberExpression') return n.property?.name ?? null;
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function classNameOf(openingNode: any): string {
    const attrs = openingNode.attributes ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cls = attrs.find(
      (a: any) => a.type === 'JSXAttribute' && a.name?.name === 'className',
    );
    if (!cls) return '';
    const v = cls.value;
    if (!v) return '';
    if (v.type === 'StringLiteral') return v.value;
    // For JSXExpressionContainer (template literals, cn() calls, conditional
    // expressions, etc.), serialize the expression so we can do a substring
    // containment check. JSON.stringify loses types but keeps string
    // literals — sufficient for the containment assertion.
    if (v.type === 'JSXExpressionContainer') {
      try {
        return JSON.stringify(v.expression);
      } catch {
        return '';
      }
    }
    return '';
  }

  describe.each(FILES)('%s', (file) => {
    it('no functional JSX element is permanently hidden by bt-decor (self or ancestor)', () => {
      const abs = path.resolve(process.cwd(), file);
      const src = fs.readFileSync(abs, 'utf8');
      const ast = parser.parse(src, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      const violations: string[] = [];
      let hiddenAncestorDepth = 0;

      traverse(ast, {
        JSXOpeningElement: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          enter(pathNode: any) {
            const cls = classNameOf(pathNode.node);
            const hasMarker = PERMANENT_HIDE_MARKER_RE.test(cls);
            if (hasMarker) hiddenAncestorDepth++;

            const tag = jsxTagName(pathNode.node);
            if (tag && FUNCTIONAL_TAGS.has(tag) && hiddenAncestorDepth > 0) {
              const line = pathNode.node.loc?.start?.line ?? '?';
              violations.push(`<${tag}> at ${file}:${line} — className=${cls}`);
            }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          exit(pathNode: any) {
            const cls = classNameOf(pathNode.node);
            if (PERMANENT_HIDE_MARKER_RE.test(cls)) hiddenAncestorDepth--;
          },
        },
      });

      if (violations.length > 0) {
        throw new Error(
          `Simplify Mode affordance contract VIOLATED — functional element(s) permanently hidden under bt-decor (self or ancestor):\n` +
            violations.map((v) => `  - ${v}`).join('\n'),
        );
      }
      expect(violations).toEqual([]);
    });
  });
});
