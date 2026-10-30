import {
  deleteBrainDumpEntries,
  prepareBrainDumpDelete,
  resolveReminderTime,
  runBrainDumpAction,
  runReminderAction,
} from '../ai-brain-dump-reminder-tools';
import { BrainDumpService } from '@/services/brain-dump-service';
import { ReminderService } from '@/services/reminder-service';
import { Storage } from '@/utils/storage';
import type { BrainDumpEntry } from '@/types/adhd';
import { AIService, formatLocalNow } from '@/services/ai-service';

jest.mock('@/utils/storage', () => ({
  Storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));

jest.mock('@/services/brain-dump-service', () => ({
  BrainDumpService: {
    add: jest.fn(),
    list: jest.fn(),
    getEntry: jest.fn(),
    updateEntry: jest.fn(),
    delete: jest.fn(),
    getPrefs: jest.fn(),
    setPrefs: jest.fn(),
  },
}));

jest.mock('@/services/reminder-service', () => ({
  ReminderService: { create: jest.fn(), listActive: jest.fn(), getAll: jest.fn(), delete: jest.fn() },
}));

const dump = BrainDumpService as jest.Mocked<typeof BrainDumpService>;
const reminders = ReminderService as jest.Mocked<typeof ReminderService>;
const storage = Storage as jest.Mocked<typeof Storage>;

const NOW = Date.UTC(2026, 9, 1, 6, 0, 0);
const entry = (id: string, text: string, url?: string): BrainDumpEntry => ({
  id, text, createdAt: 1, ...(url ? { tabContext: { url, title: 'Page' } } : {}),
});

beforeEach(() => {
  jest.clearAllMocks();
  dump.getPrefs.mockResolvedValue({ enabled: true, tabContextDefault: true });
  dump.list.mockResolvedValue([]);
  (chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1, url: 'https://example.com/a', title: 'Example' }]);
});

describe('manage_brain_dump', () => {
  it('creates a note linked to the active tab and reports a merge into an existing page note', async () => {
    dump.list.mockResolvedValue([entry('old', 'first', 'https://example.com/a')]);
    dump.add.mockResolvedValue([entry('old', 'first\nsecond', 'https://example.com/a')]);

    const result = await runBrainDumpAction({ action: 'create', text: ' second ', attachCurrentTab: true });

    expect(dump.add).toHaveBeenCalledWith({
      text: 'second',
      tabContext: { url: 'https://example.com/a', title: 'Example' },
    });
    expect(result).toMatchObject({ status: 'success', entryId: 'old', merged: true, linkedUrl: 'https://example.com/a' });
  });

  it('turns Brain Dump on when it was off and rejects empty or non-web links', async () => {
    dump.getPrefs.mockResolvedValue({ enabled: false, tabContextDefault: true });
    dump.add.mockResolvedValue([entry('n', 'idea')]);
    await runBrainDumpAction({ action: 'create', text: 'idea' });
    expect(dump.setPrefs).toHaveBeenCalledWith({ enabled: true });

    await expect(runBrainDumpAction({ action: 'create', text: '  ' })).resolves.toMatchObject({ status: 'error' });
    await expect(runBrainDumpAction({ action: 'create', text: 'x', url: 'javascript:alert(1)' }))
      .resolves.toMatchObject({ status: 'error' });
  });

  it('updates by replacing or appending, and reports missing notes', async () => {
    dump.getEntry.mockResolvedValue(entry('a', 'buy milk'));
    await runBrainDumpAction({ action: 'update', entryId: 'a', text: 'and eggs', mode: 'append' });
    expect(dump.updateEntry).toHaveBeenCalledWith('a', { text: 'buy milk\nand eggs' });

    dump.getEntry.mockResolvedValue(null);
    await expect(runBrainDumpAction({ action: 'update', entryId: 'zz', text: 'x' }))
      .resolves.toEqual({ status: 'not_found', entryId: 'zz' });
  });

  it('prepares a delete with snippets for the card, then deletes only confirmed ids', async () => {
    dump.list.mockResolvedValue([entry('a', 'first note'), entry('b', 'second note')]);

    const plan = await prepareBrainDumpDelete({ entryIds: ['a', 'b', 'missing', 'a'] });
    expect(plan).toEqual({
      ids: ['a', 'b'],
      items: [{ id: 'a', snippet: 'first note' }, { id: 'b', snippet: 'second note' }],
      missing: ['missing'],
    });
    expect(dump.delete).not.toHaveBeenCalled();

    const result = await deleteBrainDumpEntries(plan as Exclude<typeof plan, { status: 'error' }>);
    expect(dump.delete).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 'success', deletedCount: 2, notFound: ['missing'] });

    await expect(prepareBrainDumpDelete({ entryIds: ['nope'] })).resolves.toMatchObject({ status: 'error' });
  });
});

describe('set_reminder', () => {
  it('resolves relative and local clock times and rejects past or far-future ones', () => {
    expect(resolveReminderTime({ inMinutes: 90 }, NOW)).toBe(NOW + 90 * 60 * 1000);
    expect(resolveReminderTime({ at: '2026-10-02T09:00' }, NOW)).toBe(new Date(2026, 9, 2, 9, 0).getTime());
    expect(resolveReminderTime({ inMinutes: -5 }, NOW)).toHaveProperty('error');
    expect(resolveReminderTime({ at: '2028-01-01T00:00' }, NOW)).toHaveProperty('error');
    expect(resolveReminderTime({ at: 'tomorrow' }, NOW)).toHaveProperty('error');
    expect(resolveReminderTime({}, NOW)).toHaveProperty('error');
  });

  it('creates a group reminder that reopens the group tabs', async () => {
    storage.get.mockResolvedValue([{ id: 'g1', name: 'Research', tabs: [{ url: 'https://a.dev' }, { url: 'chrome://x' }] }]);
    const result = await runReminderAction({ groupId: 'g1', inMinutes: 60, recurring: 'weekdays' }, NOW);

    expect(reminders.create).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'group', targetId: 'g1', targetName: 'Research', targetUrls: ['https://a.dev'],
      fireAt: NOW + 60 * 60 * 1000, recurring: { interval: 'weekdays' },
    }));
    expect(result).toMatchObject({ status: 'success', opensTabs: 1, recurring: 'weekdays' });
  });

  it('creates a plain notification reminder from a title, and a note reminder for a Brain Dump entry', async () => {
    await runReminderAction({ title: 'Call Ayse', inMinutes: 10 }, NOW);
    expect(reminders.create).toHaveBeenLastCalledWith(expect.objectContaining({
      targetName: 'Call Ayse', targetUrls: [], notificationOnly: true, notificationBody: 'Call Ayse',
    }));

    dump.getEntry.mockResolvedValue(entry('n1', 'Draft the proposal'));
    await runReminderAction({ entryId: 'n1', inMinutes: 10 }, NOW);
    expect(reminders.create).toHaveBeenLastCalledWith(expect.objectContaining({
      targetId: 'n1', targetName: 'Draft the proposal', notificationOnly: true,
    }));

    await expect(runReminderAction({ inMinutes: 10 }, NOW)).resolves.toMatchObject({ status: 'error' });
  });

  it('passes the service error through (for example the 50-reminder limit)', async () => {
    reminders.create.mockRejectedValueOnce(new Error('[BlueTab][Reminder] Cannot create reminder: limit of 50 active reminders reached'));
    await expect(runReminderAction({ title: 'x', inMinutes: 10 }, NOW))
      .resolves.toEqual({ status: 'error', message: 'Cannot create reminder: limit of 50 active reminders reached' });
  });

  it('lists and deletes reminders', async () => {
    reminders.listActive.mockResolvedValue([{
      id: 'r1', targetType: 'tab', targetId: 't', targetName: 'Stand-up', targetUrls: [], fireAt: NOW + 1000,
      createdAt: NOW, alarmName: 'a',
    }]);
    await expect(runReminderAction({ action: 'list' }, NOW)).resolves.toMatchObject({
      count: 1, reminders: [{ reminderId: 'r1', title: 'Stand-up' }],
    });

    reminders.getAll.mockResolvedValue([]);
    await expect(runReminderAction({ action: 'delete', reminderId: 'r1' }, NOW)).resolves.toMatchObject({ status: 'not_found' });
  });
});

describe('system prompt guidance', () => {
  it('includes the local time and the no-pretend rule', () => {
    const now = new Date(2026, 9, 1, 9, 5);
    const prompt = AIService.buildSystemPrompt({ tabs: [], groupSummary: [], totalTabCount: 0 }, true, now);
    expect(prompt).toContain(`Current local time: ${formatLocalNow(now)}`);
    expect(formatLocalNow(now)).toMatch(/^2026-10-01 09:05 \(Thursday\), time zone .*\(UTC[+-]\d\d:\d\d\)$/);
    expect(prompt).toContain('NO PRETEND ACTIONS');
    expect(prompt).toContain('manage_brain_dump create');
    expect(prompt).toContain('set_reminder');
  });
});
