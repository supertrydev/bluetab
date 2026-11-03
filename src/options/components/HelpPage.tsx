import { openShortcutSettings, SHORTCUTS_SETTINGS_LABEL } from '@/platform/extension-platform';
import React, { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ChevronDown, BookOpen, ExternalLink, HelpCircle, Keyboard, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { Storage } from '../../utils/storage';

interface HelpPageProps {
  sidebarTrigger: React.ReactNode;
}

const SUPPORT_EMAIL = 'support@supertry.net';

// FAQ data
const FAQ_ITEMS = [
  {
    id: 'save-tabs',
    questionKey: 'options.helpPage.faq.saveTabs.question',
    answerKey: 'options.helpPage.faq.saveTabs.answer',
  },
  {
    id: 'storage',
    questionKey: 'options.helpPage.faq.storage.question',
    answerKey: 'options.helpPage.faq.storage.answer',
  },
  {
    id: 'projects',
    questionKey: 'options.helpPage.faq.projects.question',
    answerKey: 'options.helpPage.faq.projects.answer',
  },
  {
    id: 'cloud-sync',
    questionKey: 'options.helpPage.faq.cloudSync.question',
    answerKey: 'options.helpPage.faq.cloudSync.answer',
  },
  {
    id: 'focus-mode',
    questionKey: 'options.helpPage.faq.focusMode.question',
    answerKey: 'options.helpPage.faq.focusMode.answer',
  },
  {
    id: 'restore-group',
    questionKey: 'options.helpPage.faq.restoreGroup.question',
    answerKey: 'options.helpPage.faq.restoreGroup.answer',
  },
  {
    id: 'import-bookmarks',
    questionKey: 'options.helpPage.faq.importBookmarks.question',
    answerKey: 'options.helpPage.faq.importBookmarks.answer',
  },
  {
    id: 'shortcuts',
    questionKey: 'options.helpPage.faq.shortcuts.question',
    answerKey: 'options.helpPage.faq.shortcuts.answer',
  },
  {
    id: 'reminders',
    questionKey: 'options.helpPage.faq.reminders.question',
    answerKey: 'options.helpPage.faq.reminders.answer',
  },
  {
    id: 'data-privacy',
    questionKey: 'options.helpPage.faq.dataPrivacy.question',
    answerKey: 'options.helpPage.faq.dataPrivacy.answer',
  },
];

// Keyboard shortcuts data
const SHORTCUTS_SETTINGS_URL = SHORTCUTS_SETTINGS_LABEL;
const SHORTCUTS = [
  { keys: ['Alt', 'T'], actionKey: 'options.helpPage.shortcutActions.openBluetab' },
  { keys: ['Alt', 'S'], actionKey: 'options.helpPage.shortcutActions.saveAllTabs' },
  { keys: ['Alt', 'Q'], actionKey: 'options.helpPage.shortcutActions.openBrainDump' },
  { keys: ['Alt', 'B'], actionKey: 'options.helpPage.shortcutActions.openManager' },
];

// Release notes (latest first)
const CHANGELOG = [
  {
    version: '1.0.5',
    date: '2026-11',
    changeKeys: [
      'options.helpPage.changelog.v1_0_5_1',
      'options.helpPage.changelog.v1_0_5_2',
      'options.helpPage.changelog.v1_0_5_3',
      'options.helpPage.changelog.v1_0_5_4',
    ],
  },
  {
    version: '1.0.3',
    date: '2026-10',
    changeKeys: [
      'options.helpPage.changelog.v1_0_3_1',
      'options.helpPage.changelog.v1_0_3_2',
      'options.helpPage.changelog.v1_0_3_3',
      'options.helpPage.changelog.v1_0_3_4',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06',
    changeKeys: [
      'options.helpPage.changelog.v1_0_0_1',
      'options.helpPage.changelog.v1_0_0_2',
      'options.helpPage.changelog.v1_0_0_3',
      'options.helpPage.changelog.v1_0_0_4',
      'options.helpPage.changelog.v1_0_0_5',
      'options.helpPage.changelog.v1_0_0_6',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-03',
    changeKeys: [
      'options.helpPage.changelog.v0_9_0_1',
      'options.helpPage.changelog.v0_9_0_2',
      'options.helpPage.changelog.v0_9_0_3',
      'options.helpPage.changelog.v0_9_0_4',
      'options.helpPage.changelog.v0_9_0_5',
    ],
  },
  {
    version: '0.1.0',
    date: '2025',
    changeKeys: [
      'options.helpPage.changelog.v0_1_0_1',
      'options.helpPage.changelog.v0_1_0_2',
      'options.helpPage.changelog.v0_1_0_3',
      'options.helpPage.changelog.v0_1_0_4',
      'options.helpPage.changelog.v0_1_0_5',
    ],
  },
];

function FAQItem({ id, question, answer, isOpen, onToggle }: {
  id: string;
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        className="w-full flex items-center justify-between py-4 text-start hover:text-primary transition-colors"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
      >
        <span className="text-sm font-medium pe-4">{question}</span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="pb-4 text-sm text-muted-foreground">
          {answer}
        </div>
      )}
    </div>
  );
}

export function HelpPage({ sidebarTrigger }: HelpPageProps) {
  const { t } = useTranslation();
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);

  const faqItems = FAQ_ITEMS.map((item) => ({
    id: item.id,
    question: translate(item.questionKey),
    answer: translate(item.answerKey),
  }));

  const tabLabels = {
    faq: t('options.helpPage.tabs.faq'),
    shortcuts: t('options.helpPage.tabs.shortcuts'),
    changelog: t('options.helpPage.tabs.changelog'),
    feedback: t('options.helpPage.tabs.feedback'),
  } as const;

  const handleFaqToggle = (id: string) => {
    setOpenFaqId(prev => (prev === id ? null : id));
  };

  const handleRetakeOnboarding = async () => {
    await Storage.set('onboarding_state', { completed: false });
    await chrome.tabs.create({
      url: chrome.runtime.getURL('src/onboarding/index.html'),
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center gap-2 border-b border-border-glass px-4 bg-glass-bg backdrop-blur-md">
        {sidebarTrigger}
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-text-strong">{t('options.helpPage.title')}</h1>
            <p className="text-xs text-text-muted">{t('options.helpPage.subtitle')}</p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="max-w-3xl mx-auto w-full">
          {/* Onboarding re-trigger */}
          <div className="flex items-center justify-between mb-6 py-3 px-4 rounded-lg border border-border bg-muted/30">
            <div>
              <p className="text-sm font-medium">{t('options.helpPage.firstTimeTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('options.helpPage.firstTimeDescription')}</p>
            </div>
            <button
              onClick={handleRetakeOnboarding}
              className="text-sm text-primary hover:underline flex items-center gap-1 ms-4 flex-shrink-0"
            >
              <BookOpen className="w-4 h-4" />
              {t('options.helpPage.takeTourAgain')}
            </button>
          </div>

          {/* Tabs */}
          <Tabs.Root defaultValue="faq">
            <Tabs.List className="flex border-b border-border mb-4 gap-0">
              {(['faq', 'shortcuts', 'changelog', 'feedback'] as const).map((tab) => (
                <Tabs.Trigger
                  key={tab}
                  value={tab}
                  className="px-4 py-2 text-sm font-medium capitalize text-muted-foreground border-b-2 border-transparent hover:text-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:border-primary -mb-px"
                >
                  {tabLabels[tab]}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            {/* FAQ Tab */}
            <Tabs.Content value="faq" className="py-4">
              <div className="rounded-lg border border-border bg-card px-4">
                {faqItems.map((item) => (
                  <FAQItem
                    key={item.id}
                    id={item.id}
                    question={item.question}
                    answer={item.answer}
                    isOpen={openFaqId === item.id}
                    onToggle={handleFaqToggle}
                  />
                ))}
              </div>
            </Tabs.Content>

            {/* Shortcuts Tab */}
            <Tabs.Content value="shortcuts" className="py-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {t('options.helpPage.shortcutIntro', {
                    path: isolateBidi(SHORTCUTS_SETTINGS_URL, 'ltr'),
                  })}
                </p>
                {/* chrome:// pages cannot be opened from an <a href>; see openShortcutSettings. */}
                <button
                  type="button"
                  onClick={openShortcutSettings}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Keyboard className="h-4 w-4" />
                  {t('options.helpPage.editShortcuts')}
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SHORTCUTS.map(({ keys, actionKey }) => (
                  <div
                    key={actionKey}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
                  >
                    <span className="text-sm">{translate(actionKey)}</span>
                    <div className="flex items-center gap-1">
                      {keys.map((k, i) => (
                        <React.Fragment key={k}>
                          {i > 0 && <span className="text-muted-foreground text-xs">+</span>}
                          <kbd dir="ltr" className="px-2 py-1 rounded bg-muted border border-border text-xs font-mono">
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Tabs.Content>

            {/* Changelog Tab */}
            <Tabs.Content value="changelog" className="py-4">
              <div className="space-y-8">
                {CHANGELOG.map((entry) => (
                  <div key={entry.version} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full bg-primary mt-1 flex-shrink-0" />
                      <div className="w-px flex-1 bg-border mt-2" />
                    </div>
                    <div className="pb-4 flex-1">
                      <div className="flex items-baseline gap-3 mb-3">
                        <h3 dir="ltr" className="text-base font-semibold">v{entry.version}</h3>
                        <span dir="ltr" className="text-xs text-muted-foreground">{entry.date}</span>
                      </div>
                      <ul className="space-y-1.5">
                        {entry.changeKeys.map((changeKey) => (
                          <li key={changeKey} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-muted-foreground/60 flex-shrink-0" />
                            {translate(changeKey)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </Tabs.Content>

            {/* Feedback Tab */}
            <Tabs.Content value="feedback" className="py-4">
              <div className="space-y-6 max-w-lg">
                <div>
                  <h3 className="text-base font-semibold mb-2">{t('options.helpPage.feedback.supportTitle')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('options.helpPage.feedback.supportDescription')}
                  </p>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm"
                  >
                    <Mail className="w-4 h-4" />
                    <bdi dir="ltr">{SUPPORT_EMAIL}</bdi>
                  </a>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">{t('options.helpPage.feedback.bugTitle')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('options.helpPage.feedback.bugDescription')}
                  </p>
                  <a
                    href="https://github.com/supertrydev/bluetab/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm"
                  >
                    <ExternalLink className="w-4 h-4" />
                    {t('options.helpPage.feedback.bugButton')}
                  </a>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">{t('options.helpPage.feedback.featureTitle')}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('options.helpPage.feedback.featureDescription')}
                  </p>
                  <a
                    href="https://github.com/supertrydev/bluetab/issues/new?labels=enhancement"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm"
                  >
                    <ExternalLink className="w-4 h-4" />
                    {t('options.helpPage.feedback.featureButton')}
                  </a>
                </div>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </div>
  );
}
