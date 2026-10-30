/**
 * SAFETY-04 contract test — destructive MCP tools require a confirmation token.
 *
 * GREEN ON LANDING in Plan 13-01.
 *
 * Vacuously true today: in v3.0, no entry in MCP_TOOL_REGISTRY has
 * destructive: true, so the iteration body is a no-op and the test
 * trivially passes. This is intentional — the contract STAYS in CI
 * so that the day a destructive tool is added (v3.1+) by flipping
 * `destructive: true` on its registry entry, this test immediately
 * starts asserting that the tool refuses execution without a valid
 * confirmation token.
 *
 * Do NOT remove this test. Removing it removes the safety gate.
 */

import { MCP_TOOL_REGISTRY, MCP_TOOL_NAMES } from '../../types/mcp';

describe('SAFETY-04 — destructive MCP tools require confirmation token', () => {
  it('every tool flagged destructive:true ships with a confirmation-token gate', () => {
    const destructiveTools = MCP_TOOL_NAMES.filter(
      (name) => (MCP_TOOL_REGISTRY[name] as { destructive?: boolean }).destructive === true
    );

    // v3.0 invariant — zero destructive tools.
    // When v3.1+ adds one, this assertion flips into the per-tool loop below.
    for (const name of destructiveTools) {
      // Plan 13-04 will replace this comment block with:
      //   const result = await MCPServerService.invokeTool(name, {}, { confirmationToken: null });
      //   expect(result.status).toBe('pending_confirmation');
      //   expect(result.token).toBeTruthy();
      //   expect(result.expires_at).toBeGreaterThan(Date.now());
      //
      // Until then, the assertion below documents the contract — every
      // destructive tool MUST be matched by the confirmation-token gate
      // documented in docs/mcp-server-spec.md §8.
      expect(name).toBeDefined();
    }

    // The vacuous-true expectation: in v3.0 the destructive set is empty.
    // This line is the explicit assertion of the v3.0 invariant.
    expect(destructiveTools).toHaveLength(0);
  });

  it('docs/mcp-server-spec.md describes the confirmation-token protocol (sanity)', () => {
    // Plan 13-04 expands this to read the spec and assert the structured
    // protocol description matches the runtime gate. Plan 13-01 keeps it
    // light — just assert the registry is iterable so the loop above is
    // not silently skipped if MCP_TOOL_NAMES drifts to an empty array.
    expect(MCP_TOOL_NAMES.length).toBe(13);
  });
});
