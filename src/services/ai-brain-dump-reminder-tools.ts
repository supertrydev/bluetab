/**
 * @module services/ai-brain-dump-reminder-tools
 *
 * WHY:  The chat could only search Brain Dump and had no reminder tool, so
 *       requests like "add this to my dump" or "remind me tomorrow at 9"
 *       ended with the model claiming success without saving anything.
 *
 * WHAT: Executors for two AI tools:
 *       - manage_brain_dump: create / update / delete notes. Delete is split
 *         into prepare + execute so useAIChat can show a confirmation card
 *         in between.
 *       - set_reminder: create / list / delete reminders for a saved group,
 *         a Brain Dump note, URLs, the current tab, or a plain note.
 *       All LLM input is validated; results are small JSON objects.
 *
 * NOT:  Does not render UI or ask for confirmation itself.
 */

import { toLocalIsoWithOffset } from '@/utils/local-date';
import { BrainDumpService } from '@/services/brain-dump-service';
import { ReminderService } from '@/services/reminder-service';
import type { BrainDumpEntry } from '@/types/adhd';
import type { Reminder } from '@/types/productivity';
import type { TabGroup } from '@/types/models';
import { Storage } from '@/utils/storage';

export type AIToolArgs = Record<string, unknown>;

const MAX_NOTE_CHARS = 5000;
const MAX_DELETE_BATCH = 50;
const MIN_LEAD_MS = 30 * 1000;
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;
const SNIPPET_CHARS = 80;

function asText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function snippet(text: string, max = SNIPPET_CHARS): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function isWebUrl(url: string | undefined): url is string {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
}

async function getActiveWebTab(): Promise<{ url: string; title: string; favicon?: string } | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !isWebUrl(tab.url)) return null;
    return { url: tab.url, title: tab.title ?? tab.url, ...(tab.favIconUrl ? { favicon: tab.favIconUrl } : {}) };
}

// ============================================================================
// Brain Dump
// ============================================================================

async function createNote(args: AIToolArgs) {
    const text = asText(args.text);
    if (!text) return { status: 'error', message: 'text is required.' };
    if (text.length > MAX_NOTE_CHARS) return { status: 'error', message: `text is longer than ${MAX_NOTE_CHARS} characters.` };

    let tabContext: BrainDumpEntry['tabContext'] | undefined;
    const url = asText(args.url);
    if (url) {
        if (!isWebUrl(url)) return { status: 'error', message: 'url must start with http:// or https://.' };
        tabContext = { url, title: asText(args.urlTitle) || url };
    } else if (args.attachCurrentTab === true) {
        tabContext = (await getActiveWebTab()) ?? undefined;
    }

    // Asking to add a note means the user wants Brain Dump on.
    const prefs = await BrainDumpService.getPrefs();
    if (prefs.enabled === false) await BrainDumpService.setPrefs({ enabled: true });

    const before = await BrainDumpService.list();
    const mergeTarget = tabContext ? before.find((entry) => entry.tabContext?.url === tabContext!.url) : undefined;
    const after = await BrainDumpService.add({ text, ...(tabContext ? { tabContext } : {}) });
    const saved = after[after.length - 1];

    return {
        status: 'success',
        entryId: saved.id,
        // Same page already had a note: Brain Dump appends to it instead of adding a second one.
        merged: Boolean(mergeTarget),
        linkedUrl: saved.tabContext?.url,
        snippet: snippet(saved.text),
    };
}

async function updateNote(args: AIToolArgs) {
    const entryId = asText(args.entryId);
    const text = asText(args.text);
    if (!entryId || !text) return { status: 'error', message: 'entryId and text are required.' };
    if (text.length > MAX_NOTE_CHARS) return { status: 'error', message: `text is longer than ${MAX_NOTE_CHARS} characters.` };

    const existing = await BrainDumpService.getEntry(entryId);
    if (!existing) return { status: 'not_found', entryId };

    const nextText = args.mode === 'append' ? `${existing.text}\n${text}` : text;
    await BrainDumpService.updateEntry(entryId, { text: nextText });
    return { status: 'success', entryId, snippet: snippet(nextText) };
}

export interface BrainDumpDeletePlan {
    ids: string[];
    items: Array<{ id: string; snippet: string }>;
    missing: string[];
}

/** Resolve the notes a delete would remove, so the user can confirm them first. */
export async function prepareBrainDumpDelete(args: AIToolArgs): Promise<BrainDumpDeletePlan | { status: 'error'; message: string }> {
    const requested = [
        asText(args.entryId),
        ...(Array.isArray(args.entryIds) ? args.entryIds.map(asText) : []),
    ].filter(Boolean);
    const unique = Array.from(new Set(requested)).slice(0, MAX_DELETE_BATCH);
    if (unique.length === 0) return { status: 'error', message: 'entryId or entryIds is required. Search first to get ids.' };

    const entries = await BrainDumpService.list();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const found = unique.filter((id) => byId.has(id));
    if (found.length === 0) return { status: 'error', message: 'No matching Brain Dump notes found.' };

    return {
        ids: found,
        items: found.map((id) => ({ id, snippet: snippet(byId.get(id)!.text) })),
        missing: unique.filter((id) => !byId.has(id)),
    };
}

export async function deleteBrainDumpEntries(plan: BrainDumpDeletePlan) {
    for (const id of plan.ids) {
        await BrainDumpService.delete(id);
    }
    return {
        status: 'success',
        deletedCount: plan.ids.length,
        ...(plan.missing.length > 0 ? { notFound: plan.missing } : {}),
    };
}

/** create / update. Delete goes through prepare + confirmation + deleteBrainDumpEntries. */
export async function runBrainDumpAction(args: AIToolArgs) {
    if (args.action === 'create') return createNote(args);
    if (args.action === 'update') return updateNote(args);
    return { status: 'error', message: 'Unsupported action. Use create, update or delete.' };
}

// ============================================================================
// Reminders
// ============================================================================

/**
 * Turn the model's "when" into a timestamp. Accepts minutes from now, or an
 * ISO date-time. A date-time without an offset is read as the user's local time.
 */
export function resolveReminderTime(args: AIToolArgs, now: number = Date.now()): number | { error: string } {
    let fireAt: number | null = null;
    if (typeof args.inMinutes === 'number' && Number.isFinite(args.inMinutes)) {
        fireAt = now + Math.round(args.inMinutes) * 60 * 1000;
    } else if (typeof args.at === 'string' && args.at.trim()) {
        const parsed = Date.parse(args.at.trim());
        if (Number.isNaN(parsed)) return { error: 'at must be an ISO date-time such as 2026-10-01T09:00.' };
        fireAt = parsed;
    }
    if (fireAt === null) return { error: 'Give either inMinutes or at.' };
    if (fireAt < now + MIN_LEAD_MS) return { error: 'The reminder time must be in the future.' };
    if (fireAt > now + MAX_LEAD_MS) return { error: 'The reminder time must be within a year.' };
    return fireAt;
}

const RECURRING = new Set(['daily', 'weekly', 'weekdays']);

async function createReminder(args: AIToolArgs, now: number) {
    const fireAt = resolveReminderTime(args, now);
    if (typeof fireAt !== 'number') return { status: 'error', message: fireAt.error };

    const title = asText(args.title);
    const recurring = typeof args.recurring === 'string' && RECURRING.has(args.recurring)
        ? { interval: args.recurring as 'daily' | 'weekly' | 'weekdays' }
        : undefined;

    let target: Parameters<typeof ReminderService.create>[0] | null = null;

    const groupId = asText(args.groupId);
    const entryId = asText(args.entryId);
    const urls = Array.isArray(args.urls) ? args.urls.map(asText).filter(isWebUrl).slice(0, 20) : [];

    if (groupId) {
        const groups = (await Storage.get<TabGroup[]>('groups')) ?? [];
        const group = groups.find((candidate) => candidate.id === groupId);
        if (!group) return { status: 'not_found', groupId };
        target = {
            targetType: 'group',
            targetId: group.id,
            targetName: title || group.name,
            targetUrls: group.tabs.map((tab) => tab.url).filter(isWebUrl),
            fireAt,
        };
    } else if (entryId) {
        const entry = await BrainDumpService.getEntry(entryId);
        if (!entry) return { status: 'not_found', entryId };
        const url = entry.tabContext?.url;
        target = isWebUrl(url)
            ? { targetType: 'tab', targetId: entry.id, targetName: title || snippet(entry.text), targetUrls: [url], fireAt, notificationBody: snippet(entry.text, 200) }
            : { targetType: 'tab', targetId: entry.id, targetName: title || snippet(entry.text), targetUrls: [], fireAt, notificationOnly: true, notificationBody: snippet(entry.text, 200) };
    } else if (urls.length > 0 || args.attachCurrentTab === true) {
        const tab = urls.length === 0 ? await getActiveWebTab() : null;
        const targetUrls = urls.length > 0 ? urls : tab ? [tab.url] : [];
        if (targetUrls.length === 0) return { status: 'error', message: 'The current tab is not a web page; pass urls or a title only.' };
        target = { targetType: 'tab', targetId: `ai-${now}`, targetName: title || tab?.title || targetUrls[0], targetUrls, fireAt };
    } else {
        if (!title) return { status: 'error', message: 'title is required for a plain reminder.' };
        target = { targetType: 'tab', targetId: `ai-${now}`, targetName: title, targetUrls: [], fireAt, notificationOnly: true, notificationBody: title };
    }

    try {
        await ReminderService.create({ ...target, ...(recurring ? { recurring } : {}) });
    } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message.replace(/^(?:\[[^\]]+\]\s*)+/, '') : String(error) };
    }

    return {
        status: 'success',
        title: target.targetName,
        // Local wall-clock time with offset, so the model can repeat it as-is.
        fireAt: toLocalIsoWithOffset(fireAt),
        opensTabs: target.targetUrls.length,
        ...(recurring ? { recurring: recurring.interval } : {}),
    };
}

function summarizeReminder(reminder: Reminder) {
    return {
        reminderId: reminder.id,
        title: reminder.targetName,
        fireAt: toLocalIsoWithOffset(reminder.fireAt),
        opensTabs: reminder.targetUrls.length,
        ...(reminder.recurring ? { recurring: reminder.recurring.interval } : {}),
    };
}

export async function runReminderAction(args: AIToolArgs, now: number = Date.now()) {
    const action = args.action ?? 'create';
    if (action === 'create') return createReminder(args, now);
    if (action === 'list') {
        const active = await ReminderService.listActive();
        return { status: 'success', count: active.length, reminders: active.slice(0, 20).map(summarizeReminder) };
    }
    if (action === 'delete') {
        const reminderId = asText(args.reminderId);
        if (!reminderId) return { status: 'error', message: 'reminderId is required. List reminders first.' };
        const all = await ReminderService.getAll();
        if (!all.some((reminder) => reminder.id === reminderId)) return { status: 'not_found', reminderId };
        await ReminderService.delete(reminderId);
        return { status: 'success', deleted: reminderId };
    }
    return { status: 'error', message: 'Unsupported action. Use create, list or delete.' };
}
