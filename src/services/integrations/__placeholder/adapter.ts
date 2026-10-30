/**
 * @module services/integrations/__placeholder/adapter
 *
 * Placeholder IntegrationAdapter — returns not_implemented for all verbs.
 *
 * This file exists so dispatchVerb's dynamic import contract is verifiable
 * end-to-end before Plan 14-02..14-06 land real adapters. Each real adapter
 * lives at src/services/integrations/<id>/adapter.ts and is loaded dynamically.
 *
 * XC-01: This adapter NEVER calls chrome.storage.local.set or Storage.set.
 */

import type { IntegrationAdapter } from '../../../types/integrations';

export const adapter: IntegrationAdapter = {
  async executeVerb(
    _verb: string,
    _args: Record<string, unknown>,
    _accessToken: string,
    _accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    return { success: false, error: 'not_implemented' };
  },

  async listRecords(
    _accessToken: string,
    _accountMeta: Record<string, string>,
    _since?: Date
  ): Promise<unknown[]> {
    return [];
  },

  async validateToken(_accessToken: string): Promise<boolean> {
    return false;
  },
};
