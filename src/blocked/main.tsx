import React from 'react';
import { createRoot } from 'react-dom/client';
import BlockedPage from './BlockedPage';
import { initI18n, setDocumentTitle } from '@/i18n';
import { textSizeService } from '../utils/TextSizeService';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import '../styles/tailwind.css';

async function mountBlockedPage(): Promise<void> {
  await initI18n();
  setDocumentTitle('document.blockedTitle');

  try {
    await textSizeService.initialize();
  } catch (error) {
    console.error('Failed to initialize text size service:', error);
  }

  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  createRoot(root).render(
    <React.StrictMode>
      <LocaleDirectionProvider>
        <BlockedPage />
      </LocaleDirectionProvider>
    </React.StrictMode>
  );
}

void mountBlockedPage();
