/**
 * @module services/ai-notice
 *
 * WHY:  Chrome Web Store user data policy asks for clear in-product disclosure
 *       before data leaves the device. Bluetab AI (chat, page summary,
 *       automatic group naming, Organize, Flow suggestions, AI-suggested
 *       domains) sends tab titles, URLs, page text or visit totals to the AI
 *       backend, so the first AI use on a device shows a one-time notice.
 *
 * WHAT: "Has the user seen the AI data notice?" flag.
 *       - hasSeenAINotice() / markAINoticeSeen()
 *
 * HOW:  Stored under its own chrome.storage.local key. The key is deliberately
 *       NOT part of SyncableKey (types/sync.ts), so the notice is shown once on
 *       every device, and it is NOT in the AI settings write allowlist
 *       (utils/ai-settings-write.ts), so Bluetab AI cannot set it itself.
 *
 * NOT:  Does not show UI (see components/ai/AINoticeDialog) and does not block
 *       AI requests: the notice informs, it is not an opt-in.
 */

import { Storage } from '../utils/storage';

export const AI_NOTICE_STORAGE_KEY = 'ai_data_notice_seen';

/** Bump when the notice text changes enough that users should see it again. */
export const AI_NOTICE_VERSION = 1;

interface AINoticeRecord {
  version: number;
  seenAt: number;
}

export async function hasSeenAINotice(): Promise<boolean> {
  const record = await Storage.get<AINoticeRecord>(AI_NOTICE_STORAGE_KEY);
  return Boolean(record && record.version === AI_NOTICE_VERSION && typeof record.seenAt === 'number');
}

export async function markAINoticeSeen(): Promise<void> {
  const record: AINoticeRecord = { version: AI_NOTICE_VERSION, seenAt: Date.now() };
  await Storage.set(AI_NOTICE_STORAGE_KEY, record);
}
