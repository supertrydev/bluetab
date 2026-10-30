/** @jest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initI18n } from '@/i18n';
import { PanelErrorBoundary, importWithRetry, isChunkLoadError } from './PanelErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('render exploded');
}

describe('PanelErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  const storageSet = jest.fn();

  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local: { set: storageSet } } };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.restoreAllMocks();
    storageSet.mockReset();
  });

  it('shows a recovery card instead of unmounting everything', () => {
    act(() => {
      root.render(
        <div>
          <p>header stays</p>
          <PanelErrorBoundary panel="ai">
            <Boom />
          </PanelErrorBoundary>
        </div>,
      );
    });

    expect(container.textContent).toContain('header stays');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('This tab ran into a problem');
    expect(storageSet).toHaveBeenCalledWith({
      sidepanel_last_error: expect.objectContaining({ panel: 'ai', message: 'Error: render exploded' }),
    });
  });

  it('recognises stale chunk errors', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: chrome-extension://x/assets/AIPanel-1.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('retries a failed import once', async () => {
    jest.useFakeTimers();
    const load = jest.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce('ok');
    const promise = importWithRetry(load, 10)();
    await Promise.resolve();
    jest.advanceTimersByTime(10);
    await expect(promise).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
