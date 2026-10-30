import React from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingWizard } from './OnboardingWizard';
import { initI18n, setDocumentTitle } from '@/i18n';
import { textSizeService } from '../utils/TextSizeService';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import '../styles/tailwind.css';

async function mountOnboarding(): Promise<void> {
  await initI18n();
  setDocumentTitle('document.onboardingTitle');

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
        <OnboardingWizard />
      </LocaleDirectionProvider>
    </React.StrictMode>
  );
}

void mountOnboarding();
