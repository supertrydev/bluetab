/**
 * integration-pull-button.test.ts — Manual pull remains UI-hidden.
 *
 * Test environment: Node (Jest + ts-jest, no jsdom).
 *
 * Behavior under test (live-code contract):
 *   1. IntegrationAccountRow.tsx exists at the agreed path and renders
 *      Reconnect and Disconnect buttons.
 *   2. Manual Pull is intentionally hidden in the UI while live integration
 *      sync semantics settle.
 *   3. pullFromIntegration is NOT registered as an LLM verb (verb-taxonomy
 *      guard from Plan 14-01) — never imported by buildIntegrationToolsForTurn.
 *   4. SAFETY-02 clean.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROW_FILE = path.resolve(
  __dirname,
  '../../../settings/components/integrations/IntegrationAccountRow.tsx',
);
const rowSource = fs.readFileSync(ROW_FILE, 'utf-8');

const SVC_FILE = path.resolve(__dirname, '../../integration-service.ts');
const svcSource = fs.readFileSync(SVC_FILE, 'utf-8');

function stripComments(source: string): string {
  return source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('IntegrationAccountRow — Reconnect / Disconnect buttons', () => {
  it('component file exists', () => {
    expect(fs.existsSync(ROW_FILE)).toBe(true);
  });

  it('does not import pullFromIntegration into the account row UI', () => {
    const stripped = stripComments(rowSource);
    expect(stripped).not.toMatch(/pullFromIntegration/);
    expect(stripped).not.toMatch(/from\s+['"]@\/services\/integration-service['"]/);
  });

  it('imports disconnectAccount + launchOAuthFlow', () => {
    expect(rowSource).toMatch(/disconnectAccount/);
    expect(rowSource).toMatch(/launchOAuthFlow/);
  });

  it('renders Reconnect button', () => {
    expect(rowSource).toMatch(/Reconnect/);
  });

  it('renders Disconnect button', () => {
    expect(rowSource).toMatch(/Disconnect/);
  });

  it('keeps manual Pull controls out of rendered source', () => {
    const stripped = stripComments(rowSource);
    expect(stripped).not.toMatch(/supports_manual_pull/);
    expect(stripped).not.toMatch(/Pull/);
  });
});

describe('integration-service — verb-taxonomy guard', () => {
  it('pullFromIntegration is exported (callable from UI)', () => {
    expect(svcSource).toMatch(/export async function pullFromIntegration|export\s+function\s+pullFromIntegration/);
  });

  it('pullFromIntegration is NOT included in buildIntegrationToolsForTurn', () => {
    // The function exists in the file, but it must not be registered as an
    // LLM verb — verb-taxonomy guard (Plan 14-01).
    const builderFn = svcSource.split('export async function buildIntegrationToolsForTurn')[1] || '';
    // Split at the next top-level function so we only inspect the body.
    const builderBody = builderFn.split('\nexport ')[0];
    expect(builderBody).not.toMatch(/pullFromIntegration/);
  });
});

describe('IntegrationAccountRow — SAFETY-02', () => {
  it('source contains no SAFETY-02 forbidden words in user-facing copy', () => {
    const stripped = stripComments(rowSource);
    const FORBIDDEN = new RegExp(
      String.raw`\b(streak|missed|fail` +
        String.raw`ed|expir` +
        String.raw`ed|wasted|broken|you did not)\b|time's up`,
      'i',
    );
    expect(stripped).not.toMatch(FORBIDDEN);
  });

  it('copy is English only (no locale-specific characters)', () => {
    // Turkish code points encoded via \u so this test file stays
    // ASCII-clean and does not trip the PROCESS-02 grep guard.
    const NON_ASCII_LOCALE_CHARS = new RegExp(
      '[' +
        '\\u0131\\u0130' +  // i (dotless), I (dotted)
        '\\u011f\\u011e' +  // g-breve, G-breve
        '\\u015f\\u015e' +  // s-cedilla, S-cedilla
        '\\u00e7\\u00c7' +  // c-cedilla, C-cedilla
        '\\u00f6\\u00d6' +  // o-umlaut, O-umlaut
        '\\u00fc\\u00dc' +  // u-umlaut, U-umlaut
        ']',
    );
    expect(rowSource).not.toMatch(NON_ASCII_LOCALE_CHARS);
  });
});
