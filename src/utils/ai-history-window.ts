/**
 * @module utils/ai-history-window
 *
 * WHY:  Every chat request (including each automatic tool follow-up) used to
 *       resend the whole conversation, with every old tool result in full.
 *       Long chats grew linearly in cost while old tool payloads (group
 *       dumps, settings reads) added little.
 *
 * WHAT: Shapes the message list just before it is sent:
 *       1. Keeps the last HISTORY_MAX_MESSAGES messages, starting the window
 *          at a user message so no tool chain is cut in half.
 *       2. Keeps the last FULL_DETAIL_USER_TURNS user turns untouched
 *          (including the turn in progress).
 *       3. In older turns, tool outputs longer than OLD_TOOL_OUTPUT_MAX_CHARS
 *          are replaced by a short preview plus a note telling the model to
 *          call the tool again for fresh data. The model's own text replies
 *          are never changed, so the conversation still reads the same.
 *
 * NOT:  Does not touch stored threads; only the outgoing request.
 */

export const HISTORY_MAX_MESSAGES = 40;
export const FULL_DETAIL_USER_TURNS = 2;
export const OLD_TOOL_OUTPUT_MAX_CHARS = 2000;

interface WirePart {
    type?: string;
    output?: unknown;
    [key: string]: unknown;
}

export interface WireMessage {
    role?: string;
    parts?: WirePart[];
    [key: string]: unknown;
}

function compactToolPart(part: WirePart): WirePart {
    if (typeof part.type !== 'string' || !part.type.startsWith('tool-') || !('output' in part)) return part;
    let serialized: string;
    try {
        serialized = JSON.stringify(part.output) ?? '';
    } catch {
        return part;
    }
    if (serialized.length <= OLD_TOOL_OUTPUT_MAX_CHARS) return part;
    return {
        ...part,
        output: {
            truncated: true,
            note: 'Older tool result shortened to save space. Call the tool again if you need these details.',
            preview: serialized.slice(0, OLD_TOOL_OUTPUT_MAX_CHARS),
        },
    };
}

function compactMessage(message: WireMessage): WireMessage {
    if (!Array.isArray(message.parts)) return message;
    let changed = false;
    const parts = message.parts.map((part) => {
        const next = compactToolPart(part);
        if (next !== part) changed = true;
        return next;
    });
    return changed ? { ...message, parts } : message;
}

export function shapeHistoryForRequest<T extends WireMessage>(messages: T[]): T[] {
    if (!Array.isArray(messages) || messages.length === 0) return messages;

    // 1. Window, aligned to a user message.
    let start = Math.max(0, messages.length - HISTORY_MAX_MESSAGES);
    while (start > 0 && start < messages.length && messages[start].role !== 'user') start += 1;
    if (start >= messages.length) start = Math.max(0, messages.length - HISTORY_MAX_MESSAGES);
    const windowed = messages.slice(start);

    // 2. Everything from the Nth-last user message onward stays as-is.
    let detailFrom = 0;
    let usersSeen = 0;
    for (let index = windowed.length - 1; index >= 0; index -= 1) {
        if (windowed[index].role !== 'user') continue;
        usersSeen += 1;
        if (usersSeen === FULL_DETAIL_USER_TURNS) {
            detailFrom = index;
            break;
        }
    }

    // 3. Shorten large tool outputs in older turns only.
    return windowed.map((message, index) => (index >= detailFrom ? message : compactMessage(message) as T));
}
