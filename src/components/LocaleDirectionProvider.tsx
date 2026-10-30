import type { ReactNode } from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';
import { useTranslation } from 'react-i18next';
import { getLanguageDirection } from '@/i18n';

export function LocaleDirectionProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;

  return (
    <DirectionProvider dir={getLanguageDirection(language)}>
      {children}
    </DirectionProvider>
  );
}
