/** @jest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { initI18n } from '@/i18n';
import { ThemeToggle } from './ThemeToggle';
import { ThemeManager } from '@/utils/theme';

jest.mock('@/utils/theme', () => ({
    ThemeManager: {
        getCurrentTheme: jest.fn(),
        applyTheme: jest.fn(),
    },
}));

describe('ThemeToggle localization', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeAll(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.mocked(ThemeManager.getCurrentTheme).mockResolvedValue('dark');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        jest.clearAllMocks();
    });

    async function renderFor(language: 'en' | 'tr'): Promise<HTMLButtonElement> {
        await initI18n({ language });
        await act(async () => {
            root.render(<ThemeToggle />);
        });
        const button = container.querySelector('button');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Theme toggle not rendered');
        return button;
    }

    it('keeps the previous English literals unchanged', async () => {
        const button = await renderFor('en');

        expect(button.getAttribute('aria-label')).toBe('Toggle theme');
        expect(button.getAttribute('title')).toBe('Switch to light mode');
    });

    it('renders the Turkish equivalents in the UI', async () => {
        const button = await renderFor('tr');

        expect(button.getAttribute('aria-label')).toBe('Temayı değiştir');
        expect(button.getAttribute('title')).toBe('Açık moda geç');
    });
});
