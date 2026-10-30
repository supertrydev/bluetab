/**
 * Unit tests for ReminderService
 *
 * Tests: create, handleFired, snooze, dismiss, restoreTarget, listActive,
 *        delete, getAll, and the 50-reminder cap.
 *
 * All tests mock Storage, crypto.randomUUID, and use chrome mocks from jest-setup.ts.
 */

import { ReminderService } from './reminder-service';
import { Storage } from '@/utils/storage';
import { ALARM_NAMES } from '@/config/alarms';
import type { Reminder } from '@/types/productivity';

jest.mock('@/utils/storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;

// Mock crypto.randomUUID
const mockUUID = jest.fn();
Object.defineProperty(global, 'crypto', {
  value: { randomUUID: mockUUID },
  writable: true,
});

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'test-uuid-1',
    targetType: 'tab',
    targetId: 'tab-123',
    targetName: 'My Important Tab',
    targetUrls: ['https://example.com'],
    fireAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    createdAt: Date.now(),
    alarmName: ALARM_NAMES.REMINDER_PREFIX + 'test-uuid-1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  mockedStorage.set.mockResolvedValue(undefined);
  mockUUID.mockReturnValue('test-uuid-1');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ReminderService', () => {
  describe('create', () => {
    it('stores a reminder with generated UUID and alarmName', async () => {
      mockUUID.mockReturnValue('gen-uuid-abc');
      mockedStorage.get.mockResolvedValue(null);

      await ReminderService.create({
        targetType: 'tab',
        targetId: 'tab-1',
        targetName: 'Test Tab',
        targetUrls: ['https://example.com'],
        fireAt: 1000000 + 60 * 60 * 1000,
      });

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'reminders',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'gen-uuid-abc',
            alarmName: ALARM_NAMES.REMINDER_PREFIX + 'gen-uuid-abc',
            targetName: 'Test Tab',
            targetUrls: ['https://example.com'],
          }),
        ]),
      );
    });

    it('creates a chrome alarm with when=fireAt', async () => {
      mockedStorage.get.mockResolvedValue(null);
      const fireAt = 1000000 + 60 * 60 * 1000;

      await ReminderService.create({
        targetType: 'tab',
        targetId: 'tab-1',
        targetName: 'Test Tab',
        targetUrls: ['https://example.com'],
        fireAt,
      });

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.REMINDER_PREFIX + 'test-uuid-1',
        { when: fireAt },
      );
    });

    it('appends to existing reminders array', async () => {
      const existing = [makeReminder({ id: 'existing-1', alarmName: ALARM_NAMES.REMINDER_PREFIX + 'existing-1' })];
      mockedStorage.get.mockResolvedValue(existing);

      await ReminderService.create({
        targetType: 'group',
        targetId: 'group-5',
        targetName: 'My Group',
        targetUrls: ['https://a.com', 'https://b.com'],
        fireAt: 1000000 + 30 * 60 * 1000,
      });

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'reminders',
        expect.arrayContaining([
          expect.objectContaining({ id: 'existing-1' }),
          expect.objectContaining({ id: 'test-uuid-1' }),
        ]),
      );
    });

    it('rejects when reminder count >= 50 (alarm limit safety)', async () => {
      const existingReminders = Array.from({ length: 50 }, (_, i) =>
        makeReminder({ id: `rem-${i}`, alarmName: ALARM_NAMES.REMINDER_PREFIX + `rem-${i}` }),
      );
      mockedStorage.get.mockResolvedValue(existingReminders);

      await expect(
        ReminderService.create({
          targetType: 'tab',
          targetId: 'tab-1',
          targetName: 'One Too Many',
          targetUrls: ['https://example.com'],
          fireAt: 1000000 + 60 * 60 * 1000,
        }),
      ).rejects.toThrow();
    });

    it('sets createdAt to current timestamp', async () => {
      mockedStorage.get.mockResolvedValue(null);

      await ReminderService.create({
        targetType: 'tab',
        targetId: 'tab-1',
        targetName: 'Test Tab',
        targetUrls: ['https://example.com'],
        fireAt: 1000000 + 60 * 60 * 1000,
      });

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'reminders',
        expect.arrayContaining([
          expect.objectContaining({ createdAt: 1000000 }),
        ]),
      );
    });
  });

  describe('handleFired', () => {
    it('creates a notification with correct structure', async () => {
      const reminder = makeReminder({ id: 'fired-1', alarmName: ALARM_NAMES.REMINDER_PREFIX + 'fired-1' });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.handleFired(ALARM_NAMES.REMINDER_PREFIX + 'fired-1');

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'reminder-fired-1',
        expect.objectContaining({
          type: 'basic',
          title: 'Bluetab Reminder',
          message: reminder.targetName,
          requireInteraction: true,
          iconUrl: chrome.runtime.getURL('src/assets/icon48.png'),
          buttons: [
            { title: 'Snooze 15min' },
            { title: 'Dismiss' },
          ],
        }),
      );
    });

    it('opens target URLs in background tabs', async () => {
      const reminder = makeReminder({
        id: 'fired-2',
        alarmName: ALARM_NAMES.REMINDER_PREFIX + 'fired-2',
        targetUrls: ['https://a.com', 'https://b.com'],
      });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.handleFired(ALARM_NAMES.REMINDER_PREFIX + 'fired-2');

      expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://a.com', active: false });
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://b.com', active: false });
    });

    it('does not create notification if reminder not found', async () => {
      mockedStorage.get.mockResolvedValue([]);

      await ReminderService.handleFired(ALARM_NAMES.REMINDER_PREFIX + 'nonexistent');

      expect(chrome.notifications.create).not.toHaveBeenCalled();
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    });

    it('logs warning when reminder not found', async () => {
      mockedStorage.get.mockResolvedValue([]);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await ReminderService.handleFired(ALARM_NAMES.REMINDER_PREFIX + 'nonexistent');

      expect(warnSpy).toHaveBeenCalled();
    });

    it('does not open tabs when reminder is notificationOnly (linkless Brain Dump)', async () => {
      const reminder = makeReminder({
        id: 'notif-only-1',
        alarmName: ALARM_NAMES.REMINDER_PREFIX + 'notif-only-1',
        targetName: 'Call Mom back',
        targetUrls: [],
        notificationOnly: true,
        notificationBody: 'Call Mom back',
      });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.handleFired(ALARM_NAMES.REMINDER_PREFIX + 'notif-only-1');

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'reminder-notif-only-1',
        expect.objectContaining({
          type: 'basic',
          title: 'Bluetab Reminder',
          message: 'Call Mom back',
        }),
      );
      // Critically: no tabs opened, because there is no deep-link target.
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    });

    it('uses notificationBody as the notification message when notificationOnly', async () => {
      const reminder = makeReminder({
        id: 'notif-only-2',
        alarmName: ALARM_NAMES.REMINDER_PREFIX + 'notif-only-2',
        targetName: 'thought summary',
        targetUrls: [],
        notificationOnly: true,
        notificationBody: 'The full captured thought body that fires in the toast.',
      });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.handleFired(ALARM_NAMES.REMINDER_PREFIX + 'notif-only-2');

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'reminder-notif-only-2',
        expect.objectContaining({
          message: 'The full captured thought body that fires in the toast.',
        }),
      );
    });

    it('persists notificationOnly + notificationBody on create', async () => {
      mockedStorage.get.mockResolvedValue(null);

      await ReminderService.create({
        targetType: 'tab',
        targetId: 'brain-dump-entry-abc',
        targetName: 'short summary',
        targetUrls: [],
        fireAt: 1000000 + 30 * 60 * 1000,
        notificationOnly: true,
        notificationBody: 'full captured thought body',
      });

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'reminders',
        expect.arrayContaining([
          expect.objectContaining({
            notificationOnly: true,
            notificationBody: 'full captured thought body',
            targetUrls: [],
          }),
        ]),
      );
    });

    it('falls back to plain notification when buttons are not supported', async () => {
      const reminder = makeReminder({ id: 'fired-3', alarmName: ALARM_NAMES.REMINDER_PREFIX + 'fired-3' });
      mockedStorage.get.mockResolvedValue([reminder]);

      // First call (with buttons) fails, second call (fallback) succeeds
      (chrome.notifications.create as jest.Mock)
        .mockRejectedValueOnce(new Error('buttons not supported'))
        .mockResolvedValueOnce('notif-id');

      await ReminderService.handleFired(ALARM_NAMES.REMINDER_PREFIX + 'fired-3');

      expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
      // The fallback notification should not have buttons
      expect(chrome.notifications.create).toHaveBeenLastCalledWith(
        'reminder-fired-3',
        expect.not.objectContaining({ buttons: expect.anything() }),
      );
    });
  });

  describe('snooze', () => {
    it('updates fireAt to Date.now() + minutes*60000', async () => {
      const reminder = makeReminder({ id: 'snooze-1', fireAt: 900000 });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.snooze('snooze-1', 15);

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'reminders',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'snooze-1',
            fireAt: 1000000 + 15 * 60 * 1000,
          }),
        ]),
      );
    });

    it('sets snoozedFrom to the original fireAt', async () => {
      const originalFireAt = 900000;
      const reminder = makeReminder({ id: 'snooze-2', fireAt: originalFireAt });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.snooze('snooze-2', 15);

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'reminders',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'snooze-2',
            snoozedFrom: originalFireAt,
          }),
        ]),
      );
    });

    it('creates a new alarm with the updated fireAt', async () => {
      const reminder = makeReminder({ id: 'snooze-3', alarmName: ALARM_NAMES.REMINDER_PREFIX + 'snooze-3' });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.snooze('snooze-3', 15);

      expect(chrome.alarms.create).toHaveBeenCalledWith(
        ALARM_NAMES.REMINDER_PREFIX + 'snooze-3',
        { when: 1000000 + 15 * 60 * 1000 },
      );
    });

    it('defaults to 15 minutes when minutes not specified', async () => {
      const reminder = makeReminder({ id: 'snooze-4' });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.snooze('snooze-4');

      expect(mockedStorage.set).toHaveBeenCalledWith(
        'reminders',
        expect.arrayContaining([
          expect.objectContaining({
            fireAt: 1000000 + 15 * 60 * 1000,
          }),
        ]),
      );
    });
  });

  describe('dismiss', () => {
    it('removes the reminder from storage', async () => {
      const reminders = [
        makeReminder({ id: 'keep-1' }),
        makeReminder({ id: 'dismiss-1', alarmName: ALARM_NAMES.REMINDER_PREFIX + 'dismiss-1' }),
        makeReminder({ id: 'keep-2' }),
      ];
      mockedStorage.get.mockResolvedValue(reminders);

      await ReminderService.dismiss('dismiss-1');

      const savedReminders = mockedStorage.set.mock.calls.find(c => c[0] === 'reminders')![1] as Reminder[];
      expect(savedReminders).toHaveLength(2);
      expect(savedReminders.find(r => r.id === 'dismiss-1')).toBeUndefined();
    });

    it('clears the chrome alarm for the reminder', async () => {
      const reminder = makeReminder({
        id: 'dismiss-2',
        alarmName: ALARM_NAMES.REMINDER_PREFIX + 'dismiss-2',
      });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.dismiss('dismiss-2');

      expect(chrome.alarms.clear).toHaveBeenCalledWith(
        ALARM_NAMES.REMINDER_PREFIX + 'dismiss-2',
      );
    });
  });

  describe('restoreTarget', () => {
    it('opens each URL in targetUrls via chrome.tabs.create', async () => {
      const reminder = makeReminder({
        id: 'restore-1',
        targetUrls: ['https://a.com', 'https://b.com', 'https://c.com'],
      });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.restoreTarget('restore-1');

      expect(chrome.tabs.create).toHaveBeenCalledTimes(3);
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://a.com' });
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://b.com' });
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://c.com' });
    });

    it('dismisses the reminder after restoring', async () => {
      const reminder = makeReminder({
        id: 'restore-2',
        alarmName: ALARM_NAMES.REMINDER_PREFIX + 'restore-2',
        targetUrls: ['https://a.com'],
      });
      mockedStorage.get
        .mockResolvedValueOnce([reminder])  // first call for restoreTarget's getAll
        .mockResolvedValueOnce([reminder]); // second call for dismiss's getAll

      await ReminderService.restoreTarget('restore-2');

      // Should have cleared the alarm (from dismiss)
      expect(chrome.alarms.clear).toHaveBeenCalledWith(
        ALARM_NAMES.REMINDER_PREFIX + 'restore-2',
      );
    });
  });

  describe('listActive', () => {
    it('returns only reminders with fireAt > Date.now()', async () => {
      const reminders = [
        makeReminder({ id: 'future-1', fireAt: 1000000 + 1000 }),
        makeReminder({ id: 'past-1', fireAt: 999000 }),
        makeReminder({ id: 'future-2', fireAt: 2000000 }),
      ];
      mockedStorage.get.mockResolvedValue(reminders);

      const active = await ReminderService.listActive();

      expect(active).toHaveLength(2);
      expect(active.map(r => r.id)).toEqual(['future-1', 'future-2']);
    });

    it('returns reminders sorted by fireAt ascending', async () => {
      const reminders = [
        makeReminder({ id: 'late', fireAt: 3000000 }),
        makeReminder({ id: 'early', fireAt: 1500000 }),
        makeReminder({ id: 'middle', fireAt: 2000000 }),
      ];
      mockedStorage.get.mockResolvedValue(reminders);

      const active = await ReminderService.listActive();

      expect(active.map(r => r.id)).toEqual(['early', 'middle', 'late']);
    });

    it('returns empty array when no reminders exist', async () => {
      mockedStorage.get.mockResolvedValue(null);

      const active = await ReminderService.listActive();

      expect(active).toEqual([]);
    });
  });

  describe('delete', () => {
    it('removes reminder and clears alarm (alias for dismiss)', async () => {
      const reminder = makeReminder({
        id: 'del-1',
        alarmName: ALARM_NAMES.REMINDER_PREFIX + 'del-1',
      });
      mockedStorage.get.mockResolvedValue([reminder]);

      await ReminderService.delete('del-1');

      expect(chrome.alarms.clear).toHaveBeenCalledWith(
        ALARM_NAMES.REMINDER_PREFIX + 'del-1',
      );
      const savedReminders = mockedStorage.set.mock.calls.find(c => c[0] === 'reminders')![1] as Reminder[];
      expect(savedReminders.find(r => r.id === 'del-1')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all reminders from storage', async () => {
      const reminders = [
        makeReminder({ id: 'r1' }),
        makeReminder({ id: 'r2' }),
      ];
      mockedStorage.get.mockResolvedValue(reminders);

      const all = await ReminderService.getAll();

      expect(all).toHaveLength(2);
    });

    it('returns empty array when nothing stored', async () => {
      mockedStorage.get.mockResolvedValue(null);

      const all = await ReminderService.getAll();

      expect(all).toEqual([]);
    });
  });
});
