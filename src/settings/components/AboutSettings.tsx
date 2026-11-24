import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Check, Code2, Copy, FileText, Globe, History, LifeBuoy, Scale, ShieldCheck, Star } from 'lucide-react';
import Logo from '@/components/Logo';
import { getLanguageDirection } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { IS_FIREFOX } from '@/platform/browser-target';
import { SUPPORT_EMAIL } from '@/utils/support-contact';
import { getDiagnostics } from '../about-diagnostics';
import { THIRD_PARTY_LICENSES } from '../third-party-licenses';

const LINKS = [
  ['website', 'https://bluetab.in', Globe],
  ['releaseNotes', 'https://github.com/supertrydev/bluetab/releases', History],
  ['sourceCode', 'https://github.com/supertrydev/bluetab', Code2],
  ['reportBug', 'https://github.com/supertrydev/bluetab/issues/new?template=bug.yml', Bug],
  ['support', `mailto:${SUPPORT_EMAIL}`, LifeBuoy],
  ['privacyPolicy', 'https://supertry.net/privacy', ShieldCheck],
  ['termsOfUse', 'https://supertry.net/terms', FileText],
] as const;

const externalLinkProps = { target: '_blank', rel: 'noopener noreferrer' } as const;
const buttonClass = 'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border px-3.5 text-sm font-medium text-text-strong transition-colors hover:bg-accent hover:text-text-strong';
const iconProps = { 'aria-hidden': true, className: 'h-4 w-4 shrink-0 text-text-muted' } as const;

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
    <div dir={getLanguageDirection(language)} className="mx-auto max-w-2xl space-y-8 text-center text-text-strong">
      <header className="flex flex-col items-center gap-3">
        {/* The splash logo already shows the wordmark; its square artwork has wide empty margins. */}
        <Logo size="splash" className="-my-10" />
        <h3 className="sr-only">Bluetab</h3>
        <p className="text-sm text-text-muted">
          {t('common.version', { version: isolateBidi(version, 'ltr') })}
        </p>
        <p className="max-w-md text-sm text-text-muted">{t('settings.aboutDescription')}</p>
      </header>

      <nav aria-label={t('settings.about.links')} className="flex flex-wrap justify-center gap-2">
        {LINKS.map(([key, href, Icon]) => (
          <a key={key} href={href} {...externalLinkProps} className={buttonClass}><Icon {...iconProps} />{t(`settings.about.${key}`)}</a>
        ))}
      </nav>

      <section className="space-y-2" aria-label={t('settings.about.rate')}>
        <a
          href={IS_FIREFOX
            ? 'https://addons.mozilla.org/firefox/addon/bluetab/reviews/'
            : 'https://chromewebstore.google.com/detail/hddffdgifegmcilhcnamabcamdbpogdb/reviews'}
          {...externalLinkProps}
          className={buttonClass}
        ><Star {...iconProps} />{t('settings.about.rate')}</a>
        <p className="text-sm text-text-muted">{t('settings.about.reviewsHelp')}</p>
      </section>

      <section aria-labelledby="about-diagnostics-heading" className="rounded-lg bg-muted p-4 sm:p-6 text-start">
        <h4 id="about-diagnostics-heading" className="mb-4 font-medium">{t('settings.about.diagnostics')}</h4>
        <dl className="space-y-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
              <dt className="text-text-muted">{label}</dt>
              <dd className="min-w-0 break-words"><bdi dir="auto">{value}</bdi></dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={copyDetails} className={buttonClass}>{copyStatus === 'copied' ? <Check {...iconProps} /> : <Copy {...iconProps} />}{t('settings.about.copyDetails')}</button>
          <span role="status" aria-live="polite" className="text-sm text-text-muted">
            {copyStatus === 'copied' ? t('settings.about.copied') : copyStatus === 'error' ? t('settings.about.copyFailed') : ''}
          </span>
        </div>
      </section>

      <section aria-labelledby="about-license-heading" className="space-y-4 text-sm">
        <h4 id="about-license-heading" className="font-medium">{t('settings.about.licenseHeading')}</h4>
        <a href="https://github.com/supertrydev/bluetab/blob/main/LICENSE" {...externalLinkProps} className="inline-flex items-center gap-2 text-primary underline underline-offset-4">
          <Scale aria-hidden className="h-4 w-4 shrink-0" />{t('settings.about.license')}
        </a>
        <details className="rounded-lg border border-border text-start">
          <summary className="cursor-pointer rounded-lg p-4 font-medium">
            {t('settings.about.libraries', { count: THIRD_PARTY_LICENSES.length })}
          </summary>
          <ul className="divide-y divide-border px-4 pb-2">
            {THIRD_PARTY_LICENSES.map(({ name, version: dependencyVersion, license }) => (
              <li key={name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <bdi dir="ltr" className="min-w-0 break-all font-medium">{name}</bdi>
                <span className="text-text-muted"><bdi dir="ltr">{dependencyVersion}</bdi>{' '}<bdi dir="ltr">{license}</bdi></span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <footer className="text-sm text-text-muted">
        <a href="https://supertry.net" {...externalLinkProps} className="hover:underline">{t('settings.about.copyright')}</a>
      </footer>
    </div>
  );
}
