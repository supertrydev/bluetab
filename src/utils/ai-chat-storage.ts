/**
 * @module utils/ai-chat-storage
 *
 * WHY:  Chat threads are stored in chrome.storage.local. Tool-call parts were
 *       saved in full (large search/settings payloads) even though they are
 *       dropped every time a thread is loaded, so storage grew with data that
 *       was never shown again.
 *
 * WHAT: The single place that decides what a stored message looks like:
 *       text and reasoning parts only, last STORED_MESSAGES_PER_THREAD
 *       messages, and assistant turns that were only tool calls are skipped.
 */

export const STORED_MESSAGES_PER_THREAD = 100;
const KEPT_PART_TYPES = new Set(['text', 'reasoning']);

interface MessageLike {
    role?: string;
    parts?: Array<{ type: string }>;
}

function keepRenderableParts<T extends MessageLike>(message: T): T {
    return {
        ...message,
        parts: (message.parts ?? []).filter((part) => KEPT_PART_TYPES.has(part.type)),
    };
}

/** Messages ready for storage. */
export function toStoredMessages<T extends MessageLike>(messages: T[]): T[] {
    return messages
        .slice(-STORED_MESSAGES_PER_THREAD)
        .map(keepRenderableParts)
        .filter((message) => message.role === 'user' || (message.parts?.length ?? 0) > 0);
}

/** Messages loaded back into the chat; also cleans threads saved by older versions. */
export function toRuntimeMessages<T extends MessageLike>(messages: T[] | undefined): T[] {
    return (messages ?? []).map(keepRenderableParts);
}
