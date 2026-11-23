import { useTranslation } from 'react-i18next';
import type { FocusPreferences } from './focus-preferences';

export function FocusQuestions({ step, answers, onChange }: {
  step: number;
  answers: FocusPreferences;
  onChange: (answers: FocusPreferences) => void;
}) {
  const { t } = useTranslation();
  const timerLabels = {
    pomodoro: t('onboarding.focus.pomodoro'), flowtime: t('onboarding.focus.flowtime'),
    visual: t('onboarding.focus.visual'), none: t('onboarding.focus.none'),
  };
  if (step === 3) {
    const enabled = [
      answers.tabs !== null ? t('onboarding.focus.tabSummary', { count: answers.tabs }) : null,
      answers.timer !== 'none' ? timerLabels[answers.timer] : null,
      answers.suspend !== null ? t('onboarding.focus.suspendSummary', { minutes: answers.suspend }) : null,
    ].filter(Boolean);
    return <div className="space-y-4 text-sm text-start">
      {enabled.length ? <ul className="list-disc ps-5 space-y-2">{enabled.map(label => <li key={label}>{label}</li>)}</ul>
        : <p>{t('onboarding.focus.nothingEnabled')}</p>}
      <p>{t('onboarding.focus.tip')}</p>
      <p className="text-muted-foreground">{t('onboarding.focus.settingsHint')}</p>
    </div>;
  }
  const options = step === 0
    ? [8, 12, 20, null].map(value => ({ value: String(value), label: value === null ? t('onboarding.focus.noLimit') : String(value) }))
    : step === 1
    ? Object.entries(timerLabels).map(([value, label]) => ({ value, label }))
    : [{ value: '30', label: t('onboarding.focus.suspend30') }, { value: '120', label: t('onboarding.focus.suspend120') }, { value: 'null', label: t('onboarding.focus.leaveAlone') }];
  const selected = String(step === 0 ? answers.tabs : step === 1 ? answers.timer : answers.suspend);
  return <fieldset className="space-y-3 text-start">
    <legend className="mb-3 text-sm font-medium">{t(step === 0 ? 'onboarding.focus.question1' : step === 1 ? 'onboarding.focus.question2' : 'onboarding.focus.question3')}</legend>
    {options.map(option => <label key={option.value} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input type="radio" name={`focus-question-${step}`} value={option.value} checked={selected === option.value}
        onChange={() => onChange({ ...answers, ...(step === 0
          ? { tabs: option.value === 'null' ? null : Number(option.value) as FocusPreferences['tabs'] }
          : step === 1 ? { timer: option.value as FocusPreferences['timer'] }
          : { suspend: option.value === 'null' ? null : Number(option.value) as FocusPreferences['suspend'] }) })} />
      <span>{option.label}</span>
    </label>)}
    {step === 0 && <p className="text-xs text-muted-foreground">{t('onboarding.focus.hiddenHint')}</p>}
  </fieldset>;
}
