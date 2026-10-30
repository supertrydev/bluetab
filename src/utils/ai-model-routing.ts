/**
 * @module utils/ai-model-routing
 *
 * WHY:  The chat sends short greetings to the cheaper 'fast' model without
 *       tools. The old rule ("under 15 characters") also caught short
 *       commands such as "block x.com" or "open 3 tabs", so the model had no
 *       tool to call.
 *
 * WHAT: Decides whether a turn can skip tools. Language-agnostic: only very
 *       short messages that carry no domain, URL, path, mention or number.
 */

const SHORT_CHAT_MAX_LENGTH = 15;
/** Characters that signal a target (domain, URL, path, handle, count). */
const ACTION_HINT = /[.\/:@#\d]/;

export function isChatOnlyTurn(lastUserText: string, conversationHasToolCalls: boolean): boolean {
    const text = lastUserText.trim();
    if (conversationHasToolCalls) return false;
    if (text.length >= SHORT_CHAT_MAX_LENGTH) return false;
    return !ACTION_HINT.test(text);
}
