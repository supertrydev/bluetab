/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast as sonnerToast } from 'sonner';
import { initI18n } from '@/i18n';
import { ToastManager } from './Toast';

jest.mock('sonner', () => ({
    Toaster: () => null,
    toast: { custom: jest.fn(), dismiss: jest.fn(), error: jest.fn() },
}));
jest.mock('@/utils/support-settings', () => ({
    DEFAULT_SUPPORT_SETTINGS: { showDiagnostics: false },
    getSupportSettings: async () => ({ showDiagnostics: false }),
    SUPPORT_SETTINGS_KEY: 'supportSettings',
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await initI18n({ language: 'en' });
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    jest.useRealTimers();
    jest.clearAllMocks();
});
async function showUndo() {
    const undo = jest.fn().mockResolvedValue(true);
    ToastManager.getInstance().undo('Deleted', { expiresAt: Date.now() + 10000, undo });
    const render = jest.mocked(sonnerToast.custom).mock.calls[0][0];
    await act(async () => root.render(render('undo-toast')));
    return undo;
}
it('shows a live countdown and runs Undo when clicked', async () => {
    const undo = await showUndo();
    expect(container.textContent).toContain('10s');
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(container.textContent).toContain('7s');
    await act(async () => { container.querySelector('button')!.click(); });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(sonnerToast.dismiss).toHaveBeenCalledWith('undo-toast');
});
it('disables Undo and dismisses the toast at the deadline', async () => {
    const undo = await showUndo();
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(container.querySelector('button')!.disabled).toBe(true);
    expect(sonnerToast.dismiss).toHaveBeenCalledWith('undo-toast');
    expect(undo).not.toHaveBeenCalled();
});
