/**
 * @module types/integrations
 *
 * Zod schemas and TypeScript interfaces for the Phase 14 curated
 * third-party integration registry, token storage, and adapter contract.
 *
 * TOKEN-01: integration_tokens and all related keys MUST NOT appear in
 * delta-tracker SYNCABLE_KEYS. These are device-local tokens only.
 */

import { z } from 'zod';

// ============================================================================
// Auth Type
// ============================================================================

export const IntegrationAuthTypeSchema = z.enum([
  'oauth_pkce',
  'oauth_pkce_via_supertry',
  'token_paste',
]);

export type IntegrationAuthType = z.infer<typeof IntegrationAuthTypeSchema>;

// ============================================================================
// Registry Entry
// ============================================================================

export const IntegrationRegistryEntrySchema = z.object({
  id: z.string(),
  display_name: z.string(),
  tier: z.enum(['1', '2', '3', '4']),
  auth_type: IntegrationAuthTypeSchema,
  oauth_client_id: z.string().optional(),
  oauth_authorize_url: z.string().optional(),
  oauth_token_url: z.string().optional(),
  oauth_scopes: z.array(z.string()).optional(),
  redirect_uri_kind: z.enum(['chromiumapp', 'google-identity', 'supertry-proxy']).default('chromiumapp'),
  token_expiry_seconds: z.number().nullable(),
  supports_refresh: z.boolean().default(true),
  rate_limit_rps: z.number(),
  consent_fields: z.array(z.string()),
  verbs: z.array(z.string()),
  verb_descriptions: z.record(z.string(), z.string()).optional(),
  supports_auto_sync: z.boolean().default(true),
  supports_manual_pull: z.boolean().default(false),
  // Plan 14-06: token-paste UX hint — URL where the user copies their API
  // token (e.g. https://readwise.io/access_token). Only set on token_paste
  // entries. The Settings paste form renders this as a link.
  token_paste_instructions_url: z.string().optional(),
});

export type IntegrationRegistryEntry = z.infer<typeof IntegrationRegistryEntrySchema>;

// ============================================================================
// Token Bundle — NEVER sync, NEVER log raw tokens
// ============================================================================

export const TokenBundleSchema = z.object({
  integration_id: z.string(),
  account_id: z.string(),
  account_label: z.string(),
  access_token: z.string().optional(),
  cloud_connection_ref: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_at: z.number(),
  metadata: z.record(z.string(), z.string()),
  created_at: z.number(),
  last_used_at: z.number(),
}).refine(
  (bundle) => Boolean(bundle.access_token) !== Boolean(bundle.cloud_connection_ref),
  { message: 'Exactly one credential source is required' },
);

export type TokenBundle = z.infer<typeof TokenBundleSchema>;

// ============================================================================
// Integration Account (public shape — strips secrets)
// ============================================================================

export const IntegrationAccountSchema = z.object({
  integrationId: z.string(),
  accountId: z.string(),
  accountLabel: z.string(),
  metadata: z.record(z.string(), z.string()),
  lastUsedAt: z.number(),
  connectionKind: z.enum(['device_token', 'cloud_reference']).optional(),
});

export type IntegrationAccount = z.infer<typeof IntegrationAccountSchema>;

// ============================================================================
// Auto-Sync Mapping
// ============================================================================

export const AutoSyncMappingSchema = z.object({
  groupId: z.string(),
  integrationId: z.string(),
  accountId: z.string(),
  mirrorVerb: z.string(),
});

export type AutoSyncMapping = z.infer<typeof AutoSyncMappingSchema>;

// ============================================================================
// Verb Result
// ============================================================================

export const IntegrationVerbResultSchema = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type IntegrationVerbResult = z.infer<typeof IntegrationVerbResultSchema>;

// ============================================================================
// Adapter Interface
// ============================================================================

/**
 * Every per-integration adapter in 14-02..14-06 implements this interface.
 * Adapters call services (BrainDumpService, etc.) — NEVER chrome.storage.local directly.
 * XC-01 contract-tested.
 */
export interface IntegrationAdapter {
  executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }>;

  listRecords?(
    accessToken: string,
    accountMeta: Record<string, string>,
    since?: Date
  ): Promise<unknown[]>;

  validateToken?(accessToken: string): Promise<boolean>;
}

// ============================================================================
// AI Tool Shape (what buildIntegrationToolsForTurn returns)
// ============================================================================

export interface IntegrationAITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  integrationId: string;
  accountId: string;
  verb: string;
  tier: '1' | '2' | '3' | '4';
}
