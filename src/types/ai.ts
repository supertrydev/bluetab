/**
 * @module types/ai
 *
 * WHY:  Shared type contracts for AI features prevent runtime mismatches
 *       between the chat UI, AIService, and tool execution layer.
 *
 * WHAT: All AI-related TypeScript types, interfaces, and default constants.
 *       Covers messages, tool calls, settings, history, and confirmation state.
 *
 * HOW:  Pure type definitions — no runtime logic.
 *       Imported by ai-tools.ts, ai-service.ts, and all AI UI components.
 *
 * NOT:  Does not contain tool schemas (those are in ai-tools.ts with Zod).
 *       Does not contain service logic or storage calls.
 */

// ============================================================================
// Tool Names
// ============================================================================

/**
 * Union type of all AI tool names supported by the extension.
 */
export type AIToolName =
  | 'search_tabs'
  | 'group_tabs'
  | 'save_tabs'
  | 'archive_group'
  | 'delete_tabs'
  | 'open_tabs'
  | 'rename_group'
  | 'search_bluetab'
  | 'search_brain_dump'
  | 'search_rss'
  | 'web_search'
  | 'manage_projects'
  | 'update_settings'
  | 'get_context'
  | 'manage_groups'
  | 'create_flow_rule'
  | 'block_site'
  | 'manage_brain_dump'
  | 'set_reminder';

// ============================================================================
// Message Types
// ============================================================================

/**
 * A single AI tool invocation within a message.
 */
export interface AIToolCall {
  toolCallId: string;
  toolName: AIToolName;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'error';
}

/**
 * A single message in the AI conversation.
 */
export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: AIToolCall[];
}

// ============================================================================
// Settings
// ============================================================================

/**
 * User-configurable AI settings.
 */
export interface AISettings {
  smartNaming: boolean;
  /** Run connected-app actions (create event, issue, task...) without a confirmation card. */
  alwaysAllowIntegrationActions: boolean;
}

/**
 * Default AI settings applied when no stored settings exist.
 */
export const DEFAULT_AI_SETTINGS: AISettings = {
  smartNaming: true,
  alwaysAllowIntegrationActions: false,
};

// ============================================================================
// History
// ============================================================================

/**
 * A persisted conversation history entry.
 * Stored in ai_history (ring buffer, 50 entries max).
 */
export interface AIHistoryEntry {
  id: string;
  userMessage: string;
  assistantResponse: string;
  timestamp: number;
  toolsUsed: AIToolName[];
}

// ============================================================================
// Destructive Action Confirmation
// ============================================================================

/**
 * State for a destructive action awaiting user confirmation.
 * Shown as an interactive confirmation card in the chat UI.
 */
export interface AIConfirmationState {
  toolCallId: string;
  toolName: 'delete_tabs' | 'manage_projects' | 'manage_groups' | 'manage_brain_dump' | 'integration_action';
  /** Connected app name for integration_action cards (e.g. "Outlook Calendar"). */
  integrationName?: string;
  /** integration_action only: offer "Always allow app actions" (default true). */
  allowAlwaysAllow?: boolean;
  affectedItems: {
    id: number;
    title: string;
  }[];
  status: 'pending' | 'confirmed' | 'cancelled';
  /** Project metadata for manage_projects delete confirmations */
  projectMeta?: {
    name: string;
    color: string;
    icon: string;
    groupCount: number;
  };
}
