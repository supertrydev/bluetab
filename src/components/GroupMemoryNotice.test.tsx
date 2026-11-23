/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initI18n } from '@/i18n';
import { Storage } from '@/utils/storage';
import { GroupMemoryNotice } from './GroupMemoryNotice';
import { GROUP_MEMORY_NOTICE_KEY, showGroupMemoryNotice, shouldShowGroupMemoryNotice } from '@/services/group-memory-notice';

let root: Root;
let container: HTMLDivElement;
let data: Record<string, unknown>;
beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    data = {};
    jest.spyOn(Storage, 'get').mockImplementation(async key => (data[key] ?? null) as never);
    jest.spyOn(Storage, 'set').mockImplementation(async (key, value) => { data[key] = value; });
    await initI18n({ language: 'en' });
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<GroupMemoryNotice />));
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

it('shows only once, persists the flag, counts down and closes after 30 seconds', async () => {
    await act(async () => { expect(await showGroupMemoryNotice({})).toBe(true); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Alt+S');
    expect(document.body.textContent).toContain('Closes in 30s');
    expect(data[GROUP_MEMORY_NOTICE_KEY]).toBe(true);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(document.body.textContent).toContain('Closes in 29s');
    await act(async () => { jest.advanceTimersByTime(29000); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { expect(await showGroupMemoryNotice({})).toBe(false); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each([
    { groupMemoryEnabled: false },
    { groupMemoryAutoRemember: false },
    { restoreBehavior: 'keepInList' as const },
])('does not show or consume the flag with %j', async settings => {
    expect(await shouldShowGroupMemoryNotice(settings)).toBe(false);
    expect(await showGroupMemoryNotice(settings)).toBe(false);
    expect(data[GROUP_MEMORY_NOTICE_KEY]).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('can be closed immediately with its close button', async () => {
    await act(async () => { await showGroupMemoryNotice({}); });
    const close = document.querySelector('[role="dialog"] button') as HTMLButtonElement;
    await act(async () => { close.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(await showGroupMemoryNotice({})).toBe(false);
});
