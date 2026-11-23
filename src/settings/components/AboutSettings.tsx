import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Logo from '@/components/Logo';
import { getLanguageDirection } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { IS_FIREFOX } from '@/platform/browser-target';
import { SUPPORT_EMAIL } from '@/utils/support-contact';
import { getDiagnostics } from '../about-diagnostics';
import { THIRD_PARTY_LICENSES } from '../third-party-licenses';

const LINKS = [
  ['website', 'https://bluetab.in'],
  ['releaseNotes', 'https://github.com/supertrydev/bluetab/releases'],
  ['sourceCode', 'https://github.com/supertrydev/bluetab'],
  ['reportBug', 'https://github.com/supertrydev/bluetab/issues/new?template=bug.yml'],
  ['support', `mailto:${SUPPORT_EMAIL}`],
  ['privacyPolicy', 'https://supertry.net/privacy'],
  ['termsOfUse', 'https://supertry.net/terms'],
] as const;

const externalLinkProps = { target: '_blank', rel: 'noopener noreferrer' } as const;
const buttonClass = 'inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

export function AboutSettings() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const version = chrome.runtime.getManifest().version;
  const diagnostics = getDiagnostics({ version, extensionId: chrome.runtime.id, language, navigator });
  const rows = [
    [t('settings.about.version'), diagnostics.version],
    [t('settings.about.browser'), diagnostics.browser],
    [t('settings.about.operatingSystem'), diagnostics.platform],
    [t('settings.about.interfaceLanguage'), diagnostics.language],
    [t('settings.about.extensionId'), diagnostics.extensionId],
  ].map(([label, value]) => [label, value || t('settings.about.unavailable')]);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  const copyRequest = useRef(0);
  useEffect(() => () => {
    copyRequest.current += 1;
    clearTimeout(resetTimer.current);
  }, []);

  const copyDetails = async () => {
    const request = ++copyRequest.current;
    clearTimeout(resetTimer.current);
    setCopyStatus('idle');
    try {
      await navigator.clipboard.writeText(rows.map(([label, value]) => `${label}: ${value}`).join('\n'));
      if (request !== copyRequest.current) return;
      setCopyStatus('copied');
      resetTimer.current = setTimeout(() => setCopyStatus('idle'), 2500);
    } catch {
      if (request !== copyRequest.current) return;
      setCopyStatus('error');
    }
  };

  return (
    <div dir={getLanguageDirection(language)} className="mx-auto max-w-2xl space-y-8 text-center text-gray-900 dark:text-gray-100">
      <header className="flex flex-col items-center gap-3">
        {/* The splash logo already shows the wordmark; its square artwork has wide empty margins. */}
        <Logo size="splash" className="-my-10" />
        <h3 className="sr-only">Bluetab</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('common.version', { version: isolateBidi(version, 'ltr') })}
        </p>
        <p className="max-w-md text-sm text-gray-600 dark:text-gray-300">{t('settings.aboutDescription')}</p>
      </header>

      <nav aria-label={t('settings.about.links')} className="flex flex-wrap justify-center gap-2">
        {LINKS.map(([key, href]) => (
          <a key={key} href={href} {...externalLinkProps} className={buttonClass}>{t(`settings.about.${key}`)}</a>
        ))}
      </nav>

      <section className="space-y-2" aria-label={t('settings.about.rate')}>
        <a
          href={IS_FIREFOX
            ? 'https://addons.mozilla.org/firefox/addon/bluetab/reviews/'
            : 'https://chromewebstore.google.com/detail/hddffdgifegmcilhcnamabcamdbpogdb/reviews'}
          {...externalLinkProps}
          className={buttonClass}
        >{t('settings.about.rate')}</a>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.about.reviewsHelp')}</p>
      </section>

      <section aria-labelledby="about-diagnostics-heading" className="rounded-lg bg-gray-50 p-4 sm:p-6 dark:bg-gray-700/50 text-start">
        <h4 id="about-diagnostics-heading" className="mb-4 font-medium">{t('settings.about.diagnostics')}</h4>
        <dl className="space-y-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
              <dt className="text-gray-600 dark:text-gray-400">{label}</dt>
              <dd className="min-w-0 break-words"><bdi dir="auto">{value}</bdi></dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={copyDetails} className={buttonClass}>{t('settings.about.copyDetails')}</button>
          <span role="status" aria-live="polite" className="text-sm text-gray-600 dark:text-gray-300">
            {copyStatus === 'copied' ? t('settings.about.copied') : copyStatus === 'error' ? t('settings.about.copyFailed') : ''}
          </span>
        </div>
      </section>

      <section aria-labelledby="about-license-heading" className="space-y-4 text-sm">
        <h4 id="about-license-heading" className="font-medium">{t('settings.about.licenseHeading')}</h4>
        <a href="https://github.com/supertrydev/bluetab/blob/main/LICENSE" {...externalLinkProps} className="text-primary underline underline-offset-4">
          {t('settings.about.license')}
        </a>
        <details className="rounded-lg border border-gray-200 dark:border-gray-600 text-start">
          <summary className="cursor-pointer rounded-lg p-4 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('settings.about.libraries', { count: THIRD_PARTY_LICENSES.length })}
          </summary>
          <ul className="divide-y divide-gray-200 dark:divide-gray-600 px-4 pb-2">
            {THIRD_PARTY_LICENSES.map(({ name, version: dependencyVersion, license }) => (
              <li key={name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <bdi dir="ltr" className="min-w-0 break-all font-medium">{name}</bdi>
                <span className="text-gray-600 dark:text-gray-400"><bdi dir="ltr">{dependencyVersion}</bdi>{' · '}<bdi dir="ltr">{license}</bdi></span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <footer className="text-sm text-gray-500 dark:text-gray-400">
        <a href="https://supertry.net" {...externalLinkProps} className="hover:underline">{t('settings.about.copyright')}</a>
      </footer>
    </div>
  );
}
