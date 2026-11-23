import { showSaveNotification } from './save-notification';
import { initI18n } from '@/i18n';
import { readFileSync } from 'fs';
import { resolve } from 'path';

beforeEach(async () => {
  jest.clearAllMocks();
  Object.assign(chrome.notifications, { update: jest.fn().mockResolvedValue(true) });
  await initI18n({ language: 'en' });
});

it('shows immediately and later updates that same notification', async () => {
  let resolveMemory!: (mb: number) => void;
  const memory = new Promise<number>(resolve => { resolveMemory = resolve; });
  await showSaveNotification('Saved 6 tabs', memory);
  const [id, notification] = (chrome.notifications.create as jest.Mock).mock.calls[0];
  expect(notification.message).toBe('Saved 6 tabs');
  expect(chrome.notifications.update).not.toHaveBeenCalled();
  resolveMemory(390);
  await memory;
  expect(chrome.notifications.update).toHaveBeenCalledWith(id, { message: 'Saved 6 tabs · about 390 MB of memory freed' });
});

it.each([undefined, Promise.resolve(null)])('leaves the notification unchanged without a clear estimate', async memory => {
  await showSaveNotification('Saved tabs', memory);
  expect(chrome.notifications.update).not.toHaveBeenCalled();
});

it('wires the Alt+S save-all result and other save-all entry points to the updating notification', () => {
  const source = readFileSync(resolve(__dirname, '../background/service-worker.ts'), 'utf8');
  expect(source).toMatch(/case 'save-all-tabs':\s*await saveAllTabs\(\)/);
  expect(source).toContain("await showSaveNotification(parts.join(' · '), result.freedMemory)");
  expect(source).toContain('await markManagerWelcomePending(details.reason)');
});
