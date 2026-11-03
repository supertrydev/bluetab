/**
 * @module services/reminder-service
 *
 * WHY:  Users need to set timed reminders for tabs or groups they want to
 *       revisit later. Without reminder infrastructure, saved tabs are
 *       effectively forgotten. MV3 service workers terminate after 30s of
 *       inactivity, so reminders must use chrome.alarms (not setInterval)
 *       with state persisted in chrome.storage.local.
 *
 * WHAT: Static ReminderService class managing the full reminder lifecycle:
 *       create, fire notification, snooze, dismiss, restore target tabs,
 *       list active reminders, and delete. Each reminder gets its own
 *       chrome alarm using the ALARM_NAMES.REMINDER_PREFIX + id pattern.
 *
 * HOW:  - create() generates UUID, stores reminder, creates chrome.alarm
 *       - handleFired() finds reminder by alarm name, creates notification
 *         with Snooze/Dismiss buttons (fallback without buttons),
 *         and opens target tabs in background
 *       - snooze() updates fireAt and recreates alarm
 *       - dismiss() removes from storage and clears alarm
 *       - restoreTarget() opens stored URLs in new tabs, then dismisses
 *       - Cap at 50 active reminders (chrome alarm limit safety)
 *       - Denormalized target data (URLs + name stored directly, not references)
 *
 * NOT:  Does not render UI -- consumed by service-worker alarm handlers,
 *       notification event handlers, and settings page components.
 *       Does not handle notification button click routing (service-worker.ts).
 */

import { IS_FIREFOX } from '@/platform/browser-target';
import { ALARM_NAMES } from '@/config/alarms';
import { initI18n, t as translate } from '@/i18n';
import { Storage } from '@/utils/storage';
import type { Reminder } from '@/types/productivity';

const LOG_PREFIX = '[BlueTab][Reminder]';
const MAX_REMINDERS = 50;

export class ReminderService {
  /**
   * Create a new reminder with a chrome alarm.
   * Generates a UUID, builds the alarm name, stores the reminder, and
   * creates a chrome.alarm to fire at the specified time.
   *
   * @throws Error if reminder count >= 50 (alarm limit safety)
   */
  static async create(params: {
    targetType: 'tab' | 'group';
    targetId: string;
    targetName: string;
    targetUrls: string[];
    fireAt: number;
    recurring?: Reminder['recurring'];
    /**
     * Notification-only mode (post-ship iteration — Brain Dump linkless dumps).
     * When true, handleFired does not open any tabs — the notification body
     * (or the fallback targetName) is the entire user-facing payload.
     */
    notificationOnly?: boolean;
    /** Extra copy shown in the notification body; used for the captured thought. */
    notificationBody?: string;
  }): Promise<void> {
    const reminders = (await Storage.get<Reminder[]>('reminders')) || [];

    if (reminders.length >= MAX_REMINDERS) {
      throw new Error(
        `${LOG_PREFIX} Cannot create reminder: limit of ${MAX_REMINDERS} active reminders reached`,
      );
    }

    const id = crypto.randomUUID();
    const alarmName = ALARM_NAMES.REMINDER_PREFIX + id;

    const reminder: Reminder = {
      id,
      targetType: params.targetType,
      targetId: params.targetId,
      targetName: params.targetName,
      targetUrls: params.targetUrls,
      fireAt: params.fireAt,
      createdAt: Date.now(),
      alarmName,
      ...(params.recurring ? { recurring: params.recurring } : {}),
      ...(params.notificationOnly ? { notificationOnly: true } : {}),
      ...(params.notificationBody ? { notificationBody: params.notificationBody } : {}),
    };

    await Storage.set('reminders', [...reminders, reminder]);
    await chrome.alarms.create(alarmName, { when: params.fireAt });

    console.log(
      `${LOG_PREFIX} Created reminder "${params.targetName}" firing at ${new Date(params.fireAt).toISOString()}`,
    );
  }

  /**
   * Find an active reminder by its target ID (e.g., group ID).
   * Returns the first active reminder matching the targetId, or null.
   */
  static async findByTargetId(targetId: string): Promise<Reminder | null> {
    const reminders = (await Storage.get<Reminder[]>('reminders')) || [];
    const now = Date.now();
    return reminders.find((r) => r.targetId === targetId && r.fireAt > now) || null;
  }

  /**
   * Reschedule a reminder to a new fireAt time.
   * Updates storage and recreates the chrome alarm.
   */
  static async reschedule(reminderId: string, newFireAt: number): Promise<void> {
    const reminders = (await Storage.get<Reminder[]>('reminders')) || [];
    const idx = reminders.findIndex((r) => r.id === reminderId);
    if (idx === -1) {
      console.warn(`${LOG_PREFIX} Cannot reschedule: reminder ${reminderId} not found`);
      return;
    }
    // A new schedule replaces any snooze; recurrence then counts from newFireAt.
    const { snoozedFrom: _snoozedFrom, ...rest } = reminders[idx];
    reminders[idx] = { ...rest, fireAt: newFireAt };
    await Storage.set('reminders', reminders);
    await chrome.alarms.create(reminders[idx].alarmName, { when: newFireAt });
    console.log(`${LOG_PREFIX} Rescheduled reminder "${reminders[idx].targetName}" to ${new Date(newFireAt).toISOString()}`);
  }

  /**
   * Handle a fired reminder alarm.
   * Finds the reminder by alarm name, creates a notification with
   * Snooze 15min and Dismiss buttons (fallback: plain notification
   * if buttons are unsupported), and opens all target URLs in
   * background tabs so the user gets their content immediately.
   */
  static async handleFired(alarmName: string): Promise<void> {
    await initI18n();
    console.log(`${LOG_PREFIX} handleFired called for: ${alarmName}`);

    const reminders = (await Storage.get<Reminder[]>('reminders')) || [];
    const reminderId = alarmName.replace(ALARM_NAMES.REMINDER_PREFIX, '');
    const reminder = reminders.find((r) => r.id === reminderId);

    if (!reminder) {
      console.warn(
        `${LOG_PREFIX} Alarm fired for unknown reminder: ${alarmName} (${reminders.length} reminders in storage)`,
      );
      return;
    }

    const notificationId = `reminder-${reminderId}`;
    const iconUrl = chrome.runtime.getURL('src/assets/icon48.png');

    // Notification-only reminders (linkless Brain Dump dumps) surface the
    // captured thought in the notification body rather than the target
    // name; the target name stays the short summary that shows in the
    // notification title-adjacent area.
    const message = reminder.notificationOnly && reminder.notificationBody
      ? reminder.notificationBody
      : reminder.targetName;
    const fallbackMessage = reminder.notificationOnly
      ? message
      : `${reminder.targetName} — click to open tabs`;

    try {
      // Firefox notifications have no buttons: go straight to the plain one.
      if (IS_FIREFOX) throw new Error('Notification buttons unsupported');
      // Try creating notification with action buttons
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        title: translate('notifications.reminderTitle'),
        message,
        iconUrl,
        buttons: [
          { title: translate('notifications.reminderSnooze') },
          { title: translate('notifications.reminderDismiss') },
        ],
        requireInteraction: true,
      });
    } catch {
      // Fallback: some platforms (Linux) don't support buttons/requireInteraction
      console.warn(`${LOG_PREFIX} Notification with buttons not supported, trying plain`);
      try {
        await chrome.notifications.create(notificationId, {
          type: 'basic',
          title: translate('notifications.reminderTitle'),
          message: fallbackMessage,
          iconUrl,
        });
      } catch (fallbackErr) {
        console.error(`${LOG_PREFIX} Fallback notification did not fire:`, fallbackErr);
      }
    }

    // Notification-only reminders skip the tab-opening step — they have no
    // deep-link target (linkless Brain Dump dumps), so the notification
    // body IS the payload.
    if (reminder.notificationOnly) {
      console.log(
        `${LOG_PREFIX} Fired notification-only reminder "${reminder.targetName}"`,
      );
      return;
    }

    // Open the target tabs directly so the user gets their content
    // even if the notification fails or is dismissed without interaction
    for (const url of reminder.targetUrls) {
      try {
        await chrome.tabs.create({ url, active: false });
      } catch (tabErr) {
        console.error(`${LOG_PREFIX} Could not open tab ${url}:`, tabErr);
      }
    }

    console.log(
      `${LOG_PREFIX} Fired reminder "${reminder.targetName}" — opened ${reminder.targetUrls.length} tab(s)`,
    );
  }

  /**
   * Snooze a reminder by updating its fireAt and recreating the alarm.
   *
   * @param reminderId - The reminder's UUID
   * @param minutes - Minutes to snooze (default 15)
   */
  static async snooze(reminderId: string, minutes: number = 15): Promise<void> {
    const reminders = (await Storage.get<Reminder[]>('reminders')) || [];
    const idx = reminders.findIndex((r) => r.id === reminderId);

    if (idx === -1) {
      console.warn(`${LOG_PREFIX} Cannot snooze: reminder ${reminderId} not found`);
      return;
    }

    const newFireAt = Date.now() + minutes * 60 * 1000;
    reminders[idx] = {
      ...reminders[idx],
      fireAt: newFireAt,
      snoozedFrom: reminders[idx].fireAt,
    };

    await Storage.set('reminders', reminders);
    await chrome.alarms.create(reminders[idx].alarmName, { when: newFireAt });

    console.log(
      `${LOG_PREFIX} Snoozed reminder "${reminders[idx].targetName}" for ${minutes} minutes`,
    );
  }

  /**
   * Dismiss a reminder: remove from storage and clear its alarm.
   */
  static async dismiss(reminderId: string): Promise<void> {
    const reminders = (await Storage.get<Reminder[]>('reminders')) || [];
    const reminder = reminders.find((r) => r.id === reminderId);

    if (!reminder) {
      console.warn(`${LOG_PREFIX} Cannot dismiss: reminder ${reminderId} not found`);
      return;
    }

    const filtered = reminders.filter((r) => r.id !== reminderId);
    await Storage.set('reminders', filtered);
    await chrome.alarms.clear(reminder.alarmName);

    console.log(`${LOG_PREFIX} Dismissed reminder "${reminder.targetName}"`);
  }

  /**
   * Restore a reminder's target by opening all stored URLs in new tabs,
   * then dismiss the reminder.
   */
  static async restoreTarget(reminderId: string): Promise<void> {
    const reminders = (await Storage.get<Reminder[]>('reminders')) || [];
    const reminder = reminders.find((r) => r.id === reminderId);

    if (!reminder) {
      console.warn(`${LOG_PREFIX} Cannot restore: reminder ${reminderId} not found`);
      return;
    }

    for (const url of reminder.targetUrls) {
      await chrome.tabs.create({ url });
    }

    console.log(
      `${LOG_PREFIX} Restored ${reminder.targetUrls.length} tab(s) for "${reminder.targetName}"`,
    );

    await ReminderService.dismiss(reminderId);
  }

  /**
   * List all active reminders (fireAt in the future), sorted by fireAt ascending.
   */
  static async listActive(): Promise<Reminder[]> {
    const reminders = (await Storage.get<Reminder[]>('reminders')) || [];
    const now = Date.now();

    return reminders
      .filter((r) => r.fireAt > now)
      .sort((a, b) => a.fireAt - b.fireAt);
  }

  /**
   * Delete a reminder. Alias for dismiss (remove from storage + clear alarm).
   */
  static async delete(reminderId: string): Promise<void> {
    await ReminderService.dismiss(reminderId);
  }

  /**
   * Get all reminders from storage (active and past).
   */
  static async getAll(): Promise<Reminder[]> {
    return (await Storage.get<Reminder[]>('reminders')) || [];
  }
}
