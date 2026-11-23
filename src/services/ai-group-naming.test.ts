import { suggestGroupName } from './ai-group-naming';
import { Storage } from '../utils/storage';
import { getAccessToken } from '../utils/auth-state';
import { canAccessFeature } from '../utils/feature-gate';
import { AIAllowanceService } from './ai-allowance-service';
jest.mock('../utils/storage');
jest.mock('../utils/auth-state', () => ({ getAccessToken: jest.fn() }));
jest.mock('../utils/feature-gate', () => ({ canAccessFeature: jest.fn() }));
jest.mock('./ai-allowance-service', () => ({ AIAllowanceService: { syncFromAIResponse: jest.fn() } }));
jest.mock('../i18n', () => ({ getResolvedLanguage: jest.fn().mockResolvedValue('tr') }));
const tabs = Array.from({ length: 12 }, (_, i) => ({ title: `Tab ${i}`, url: `https://example.com/${i}` }));
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  (Storage.get as jest.Mock).mockResolvedValue({ smartNaming: true });
  jest.mocked(getAccessToken).mockResolvedValue('token');
  jest.mocked(canAccessFeature).mockResolvedValue({ allowed: true });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'Research' }) });
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
it('preserves auth, first ten tabs, the UI language, allowance updates and the 15-second timeout', async () => {
  const timeout = jest.spyOn(AbortSignal, 'timeout');
  expect(await suggestGroupName(tabs)).toBe('Research');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/ai/name-group'), expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify({ tabs: tabs.slice(0, 10), language: 'tr' }),
  }));
  expect(timeout).toHaveBeenCalledWith(15_000);
  expect(AIAllowanceService.syncFromAIResponse).toHaveBeenCalled();
});
it('does not send tab data when the preference or Pro entitlement is off', async () => {
  jest.mocked(canAccessFeature).mockResolvedValue({ allowed: false, reason: 'not_subscribed' });
  expect(await suggestGroupName(tabs)).toBeNull();
  jest.mocked(canAccessFeature).mockResolvedValue({ allowed: true });
  (Storage.get as jest.Mock).mockResolvedValue({ smartNaming: false });
  expect(await suggestGroupName(tabs)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps the default name when authentication, HTTP or network requests fail', async () => {
  jest.mocked(getAccessToken).mockRejectedValueOnce(new Error('storage unavailable'));
  expect(await suggestGroupName(tabs)).toBeNull();
  jest.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);
  expect(await suggestGroupName(tabs)).toBeNull();
  jest.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));
  expect(await suggestGroupName(tabs)).toBeNull();
});
