/**
 * @module utils/ai-tool-loop
 *
 * WHY:  After every tool result the chat automatically sends a new request so
 *       the model can continue. Nothing capped that loop: a tool that kept
 *       failing let the model retry indefinitely, each retry a full request
 *       with reasoning tokens.
 *
 * WHAT: Decides whether to send the next automatic request for the current
 *       turn. Stops after MAX_AUTO_TOOL_ROUNDS tool rounds, or as soon as the
 *       same tool fails twice with the same arguments; the stop carries the
 *       tool's error code so the chat can explain, in the UI language, why
 *       nothing happened. Tool messages are English and meant for the model.
 */

export const MAX_AUTO_TOOL_ROUNDS = 4;

interface LoopPart {
    type?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    state?: string;
}

interface LoopMessage {
    role?: string;
    parts?: LoopPart[];
}

/**
 * Stable error codes a tool can return next to its English `message`. Each
 * one has a localized notice at `sidepanel.aiChatThread.toolErrors.<code>`.
 */
export const TOOL_ERROR_CODES = [
    'notConnected',
    'missingFields',
    'notionPageMissing',
    'githubRepoMissing',
    'targetMissing',
    'reconnect',
    'signIn',
    'accountUnsupported',
    'appError',
] as const;

export type ToolErrorCode = typeof TOOL_ERROR_CODES[number];

export type ToolErrorOutput = {
    status: 'error';
    /** English, for the model. */
    message: string;
    code?: ToolErrorCode;
    /** Interpolation values for the localized notice (e.g. the app name). */
    params?: Record<string, string>;
};

export type ToolLoopStop =
    | { reason: 'max_rounds' }
    | { reason: 'repeated_error'; code?: ToolErrorCode; params?: Record<string, string> };

export type ToolLoopDecision = { continue: true } | ({ continue: false } & ToolLoopStop);

function isToolPart(part: LoopPart): boolean {
    return typeof part.type === 'string' && (part.type.startsWith('tool-') || part.type === 'dynamic-tool');
}

function isErrorOutput(output: unknown): boolean {
    return Boolean(output) && typeof output === 'object'
        && (output as { status?: unknown }).status === 'error';
}

function isToolErrorCode(value: unknown): value is ToolErrorCode {
    return typeof value === 'string' && (TOOL_ERROR_CODES as readonly string[]).includes(value);
}

function errorDetails(output: unknown): { code?: ToolErrorCode; params?: Record<string, string> } {
    const { code, params } = output as { code?: unknown; params?: unknown };
    if (!isToolErrorCode(code)) return {};
    const strings = params && typeof params === 'object' && !Array.isArray(params)
        ? Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'string')) as Record<string, string>
        : undefined;
    return strings && Object.keys(strings).length > 0 ? { code, params: strings } : { code };
}

function signature(part: LoopPart): string {
    try {
        return `${part.type}:${JSON.stringify(part.input ?? null)}`;
    } catch {
        return String(part.type);
    }
}

export function decideToolLoop(messages: LoopMessage[]): ToolLoopDecision {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.parts)) return { continue: true };

    // One assistant message spans the whole turn; each step-start begins a round.
    const parts = last.parts;
    let rounds = 0;
    let roundHasTool = false;
    for (const part of parts) {
        if (part.type === 'step-start') {
            if (roundHasTool) rounds += 1;
            roundHasTool = false;
        } else if (isToolPart(part)) {
            roundHasTool = true;
        }
    }
    if (roundHasTool) rounds += 1;
    if (rounds >= MAX_AUTO_TOOL_ROUNDS) return { continue: false, reason: 'max_rounds' };

    const failures = new Map<string, number>();
    for (const part of parts) {
        if (!isToolPart(part) || !isErrorOutput(part.output)) continue;
        const key = signature(part);
        const count = (failures.get(key) ?? 0) + 1;
        if (count >= 2) return { continue: false, reason: 'repeated_error', ...errorDetails(part.output) };
        failures.set(key, count);
    }
    return { continue: true };
}

/**
 * The error an identical call (same tool, same arguments) already returned in
 * the current turn. Lets a caller answer a repeated call without running it
 * again, e.g. without showing a second confirmation card for a connected-app
 * action that just did not go through.
 */
export function previousToolError(messages: LoopMessage[], toolName: string, input: unknown): ToolErrorOutput | null {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.parts)) return null;
    const key = signature({ type: `tool-${toolName}`, input });
    for (const part of last.parts) {
        if (!isToolPart(part) || !isErrorOutput(part.output)) continue;
        const sameTool = part.type === 'dynamic-tool' ? part.toolName === toolName : part.type === `tool-${toolName}`;
        if (sameTool && signature({ type: `tool-${toolName}`, input: part.input }) === key) {
            const message = (part.output as { message?: unknown }).message;
            return {
                status: 'error',
                message: typeof message === 'string' && message.trim() !== '' ? message : 'The action did not complete.',
                ...errorDetails(part.output),
            };
        }
    }
    return null;
}

/** i18n key and values for the notice shown when the loop stopped. */
export function toolLoopNotice(stop: ToolLoopStop): { key: string; params?: Record<string, string> } {
    if (stop.reason === 'repeated_error' && stop.code) {
        return { key: `sidepanel.aiChatThread.toolErrors.${stop.code}`, params: stop.params };
    }
    return { key: 'sidepanel.aiChatThread.toolLoopStopped' };
}
