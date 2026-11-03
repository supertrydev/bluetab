/**
 * @module settings/components/PomodoroSettings
 *
 * WHY:  Users need to configure Pomodoro timer durations, choose presets,
 *       review session activity as a heatmap, and configure session sounds.
 *
 * WHAT: Settings section with preset selector (Classic/Short/Deep Work/Custom),
 *       custom duration inputs when Custom is selected, today's summary stats,
 *       a 30-day GitHub-style dot heatmap for session activity,
 *       and configurable session transition sounds.
 *
 * HOW:  - PomodoroService for getState, getTodaySummary, getHistory, setPreset
 *       - Direct Storage.set('pomodoroSettings', ...) for custom duration updates
 *       - Debounced inputs (400ms) for custom durations per project convention
 *
 * NOT:  Does not start/stop timer — that's PomodoroBar's job.
 */

import { previewNotificationSound } from '@/platform/extension-platform';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Timer, Shield, Play, Volume2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ToastManager } from '@/components/Toast';
import { normalizeFocusSettings } from '@/config/focus-presets';
import { getLocaleTag } from '@/i18n';
import { formatDate, getLocaleWeekInfo } from '@/i18n/format';
import { isolateBidi } from '@/i18n/bidi';
import { PomodoroService } from '@/services/pomodoro-service';
import { requestFocusSiteAccess } from '@/services/focus-site-access';
import { Storage } from '@/utils/storage';
import type { PomodoroSession, PomodoroSettings as PomodoroSettingsType, FocusSettings as FocusSettingsType } from '@/types/productivity';
import type { NotificationSound } from '@/types/rss';
import { useTranslation } from 'react-i18next';

type PresetKey = PomodoroSettingsType['preset'];

function getSoundOptions(t: (key: string) => string): { value: NotificationSound; label: string }[] {
  return [
    { value: 'ping', label: t('common.sounds.ping') },
    { value: 'drop', label: t('common.sounds.drop') },
    { value: 'blip', label: t('common.sounds.blip') },
    { value: 'soft-chime', label: t('common.sounds.softChime') },
    { value: 'ripple', label: t('common.sounds.ripple') },
    { value: 'level-up', label: t('common.sounds.levelUp') },
    { value: 'gentle-bell', label: t('common.sounds.gentleBell') },
    { value: 'crystal', label: t('common.sounds.crystal') },
    { value: 'shimmer', label: t('common.sounds.shimmer') },
    { value: 'breeze', label: t('common.sounds.breeze') },
  ];
}

/** Preview a sound via the offscreen document (same mechanism as service worker). */
async function previewSound(sound: NotificationSound): Promise<void> {
  await previewNotificationSound(sound, 'Previewing notification sound');
}

function getDefaultSettings(): PomodoroSettingsType {
  return {
    preset: 'classic',
    customWork: 25,
    customShortBreak: 5,
    customLongBreak: 15,
    longBreakInterval: 4,
  };
}

/**
 * GitHub-style contribution heatmap for the last ~52 weeks of Pomodoro work sessions.
 * Rows follow the locale's week (e.g. Mon-Sun or Sun-Sat), columns = weeks.
 * Month labels on top. Legend at bottom-right.
 */
function PomodoroHeatmap({ sessions }: { sessions: PomodoroSession[] }) {
  const { t } = useTranslation();
  const countByDay: Record<string, number> = {};
  for (const s of sessions) {
    if (s.type !== 'work') continue;
    const d = new Date(s.completedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    countByDay[key] = (countByDay[key] ?? 0) + 1;
  }

  // Today in local time
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Rows follow the locale's week (Mon-Sun, Sun-Sat, Sat-Fri...). Extend to
  // the last day of the current week, then go back 52 weeks.
  const { firstDay } = getLocaleWeekInfo();
  const lastDay = (firstDay + 6) % 7;
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + ((lastDay - endOfWeek.getDay() + 7) % 7));

  const startMonday = new Date(endOfWeek);
  startMonday.setDate(startMonday.getDate() - (52 * 7) + 1); // 52 weeks back, lands on firstDay

  // Build all dates
  const allDates: Date[] = [];
  const cursor = new Date(startMonday);
  while (cursor <= endOfWeek) {
    allDates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const totalCols = Math.ceil(allDates.length / 7);

  // Month labels: find the first Monday of each month to position labels
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let col = 0; col < totalCols; col++) {
    const date = allDates[col * 7]; // Monday of this column
    if (date && date.getMonth() !== lastMonth) {
      lastMonth = date.getMonth();
      monthLabels.push({
        col,
        label: new Intl.DateTimeFormat(getLocaleTag(), { month: 'short' }).format(date),
      });
    }
  }

  function cellStyle(count: number): React.CSSProperties {
    if (count === 0) return {};
    if (count === 1) return { backgroundColor: 'hsl(217 91% 60% / 0.4)' };
    if (count === 2) return { backgroundColor: 'hsl(217 91% 60% / 0.6)' };
    if (count === 3) return { backgroundColor: 'hsl(217 91% 60% / 0.8)' };
    return { backgroundColor: 'hsl(217 91% 60% / 1)' };
  }

  function cellClass(count: number, isFuture: boolean): string {
    if (isFuture) return 'invisible';
    if (count === 0) return 'bg-muted border border-border/40';
    return '';
  }

  function tooltipText(date: Date, count: number): string {
    const formatted = formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' });
    return count === 0
      ? t('settings.pomodoro.heatmap.noSessions', { date: isolateBidi(formatted, 'ltr') })
      : t('settings.pomodoro.heatmap.sessions', {
          date: isolateBidi(formatted, 'ltr'),
          count,
        });
  }

  const cellSize = 10;
  const gap = 2;

  return (
    <div dir="ltr" className="overflow-x-auto scrollbar-transparent">
      <div className="inline-flex flex-col gap-1" style={{ minWidth: totalCols * (cellSize + gap) + 30 }}>
        {/* Month labels */}
        <div className="flex" style={{ paddingLeft: 30 }}>
          {monthLabels.map(({ col, label }, i) => (
            <span
              key={i}
              className="text-micro text-muted-foreground"
              style={{
                position: 'absolute' as const,
                left: 30 + col * (cellSize + gap),
              }}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="flex items-start gap-0 relative" style={{ marginTop: 14 }}>
          {/* Day labels */}
          <div className="flex flex-col shrink-0" style={{ width: 28, gap }}>
            {Array.from({ length: 7 }, (_, row) => {
              // Label rows 1, 3 and 5 of the week; 2026-06-07 is a Sunday (getDay 0).
              if (row % 2 !== 0 || row === 6) return '';
              const weekday = (firstDay + row) % 7;
              return new Intl.DateTimeFormat(getLocaleTag(), { weekday: 'short' }).format(new Date(2026, 5, 7 + weekday));
            }).map((label, i) => (
              <div key={i} style={{ height: cellSize }} className="flex items-center">
                <span className="text-micro text-muted-foreground leading-none">{label}</span>
              </div>
            ))}
          </div>

          {/* Grid */}
          <div
            className="grid"
            style={{
              gridTemplateRows: `repeat(7, ${cellSize}px)`,
              gridTemplateColumns: `repeat(${totalCols}, ${cellSize}px)`,
              gridAutoFlow: 'column',
              gap,
            }}
          >
            {allDates.map((date, idx) => {
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const count = countByDay[key] ?? 0;
              const isFuture = key > todayStr;
              return (
                <div
                  key={idx}
                  className={`rounded-sm ${cellClass(count, isFuture)}`}
                  style={{ width: cellSize, height: cellSize, ...cellStyle(count) }}
                  title={isFuture ? '' : tooltipText(date, count)}
                />
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-1 mt-1 pe-1">
          <span className="text-micro text-muted-foreground me-1">{t('settings.pomodoro.heatmap.less')}</span>
          <div className="rounded-sm bg-muted border border-border/40" style={{ width: cellSize, height: cellSize }} />
          {[0.4, 0.6, 0.8, 1].map((alpha, i) => (
            <div
              key={i}
              className="rounded-sm"
              style={{ width: cellSize, height: cellSize, backgroundColor: `hsl(217 91% 60% / ${alpha})` }}
            />
          ))}
          <span className="text-micro text-muted-foreground ms-1">{t('settings.pomodoro.heatmap.more')}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Debounced number input that delays onChange by 400ms.
 * Follows the DebouncedInput pattern from project conventions.
 */
function DebouncedNumberInput({
  value,
  onChange,
  min = 1,
  max = 120,
  label,
}: {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState(String(value));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setLocalValue(raw);

      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed >= min && parsed <= max) {
          onChange(parsed);
        }
      }, 400);
    },
    [onChange, min, max],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600 dark:text-gray-400 min-w-[120px]">
        {label}
      </label>
      <input
        type="number"
        dir="ltr"
        min={min}
        max={max}
        value={localValue}
        onChange={handleChange}
        className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <span className="text-xs text-muted-foreground">{t('common.minuteShort')}</span>
    </div>
  );
}

export function PomodoroSettings() {
  const { t } = useTranslation();
  const translate = (key: string) => t(key as never) as unknown as string;
  const [settings, setSettings] = useState<PomodoroSettingsType>(getDefaultSettings);
  const [todaySummary, setTodaySummary] = useState({ sessionsCompleted: 0, totalFocusMinutes: 0 });
  const [history, setHistory] = useState<PomodoroSession[]>([]);
  const [autoFocus, setAutoFocus] = useState(true);
  const [blockDuringBreaks, setBlockDuringBreaks] = useState(false);

  // Session sounds state (default: enabled)
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [workStartSound, setWorkStartSound] = useState<NotificationSound>('blip');
  const [shortBreakSound, setShortBreakSound] = useState<NotificationSound>('soft-chime');
  const [longBreakSound, setLongBreakSound] = useState<NotificationSound>('crystal');
  const soundOptions = getSoundOptions(translate);

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      const stored = await Storage.get<PomodoroSettingsType>('pomodoroSettings');
      if (stored) {
        setSettings(stored);
        if (stored.sounds) {
          setSoundsEnabled(stored.sounds.enabled);
          setWorkStartSound(stored.sounds.workStart);
          setShortBreakSound(stored.sounds.shortBreak);
          setLongBreakSound(stored.sounds.longBreak);
        }
      }

      const focusSettings = await Storage.get<FocusSettingsType>('focusSettings');
      setAutoFocus(focusSettings?.autoEnableWithPomodoro ?? true);
      setBlockDuringBreaks(focusSettings?.blockDuringBreaks ?? false);

      const summary = await PomodoroService.getTodaySummary();
      setTodaySummary(summary);

      const sessions = await PomodoroService.getHistory(365);
      // Sort newest first
      setHistory(sessions.sort((a, b) => b.completedAt - a.completedAt));
    };
    loadData();
  }, []);

  // Listen for storage changes to update history/summary in real-time
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.pomodoroSettings) {
        setSettings(changes.pomodoroSettings.newValue);
      }
      if (changes.pomodoroHistory) {
        const allHistory: PomodoroSession[] = changes.pomodoroHistory.newValue || [];
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const recent = allHistory
          .filter((s: PomodoroSession) => s.completedAt >= cutoff)
          .sort((a: PomodoroSession, b: PomodoroSession) => b.completedAt - a.completedAt);
        setHistory(recent);

        // Recalculate today's summary
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();
        const todayWork = allHistory.filter(
          (s: PomodoroSession) => s.type === 'work' && s.completedAt >= todayMs,
        );
        setTodaySummary({
          sessionsCompleted: todayWork.length,
          totalFocusMinutes: todayWork.reduce((sum: number, s: PomodoroSession) => sum + s.duration, 0),
        });
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  const handlePresetChange = async (preset: PresetKey) => {
    await PomodoroService.setPreset(preset);
    setSettings((prev) => ({ ...prev, preset }));
  };

  const handleCustomDurationChange = async (
    key: 'customWork' | 'customShortBreak' | 'customLongBreak' | 'longBreakInterval',
    value: number,
  ) => {
    const updated = { ...settings, [key]: value };
    await Storage.set('pomodoroSettings', updated);
    setSettings(updated);
  };

  const updateSounds = async (patch: Partial<NonNullable<PomodoroSettingsType['sounds']>>) => {
    const current = await Storage.get<PomodoroSettingsType>('pomodoroSettings');
    const currentSounds = current?.sounds ?? {
      enabled: false,
      workStart: 'blip' as NotificationSound,
      shortBreak: 'soft-chime' as NotificationSound,
      longBreak: 'crystal' as NotificationSound,
    };
    const updated = { ...current, sounds: { ...currentSounds, ...patch } };
    await Storage.set('pomodoroSettings', updated);
  };

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
        <Timer className="w-5 h-5" />
        {t('settings.pomodoro.title')}
      </h3>

      <div className="space-y-6">
        {/* Preset Selector */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
            {t('settings.pomodoro.timerPreset')}
          </label>
          <div className="flex flex-wrap gap-2">
            {(['classic', 'short', 'deepWork', 'custom'] as PresetKey[]).map((key) => (
              <button
                key={key}
                onClick={() => handlePresetChange(key)}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                  settings.preset === key
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
              >
                <div>{t(`settings.pomodoro.presets.${key}.label`)}</div>
                <div className="text-xs opacity-70">{t(`settings.pomodoro.presets.${key}.description`)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Duration Inputs (only when Custom preset selected) */}
        {settings.preset === 'custom' && (
          <div className="space-y-3 p-4 border border-border rounded-lg bg-gray-50 dark:bg-gray-800/50">
            <DebouncedNumberInput
              label={t('settings.pomodoro.custom.workDuration')}
              value={settings.customWork}
              onChange={(v) => handleCustomDurationChange('customWork', v)}
            />
            <DebouncedNumberInput
              label={t('settings.pomodoro.custom.shortBreak')}
              value={settings.customShortBreak}
              onChange={(v) => handleCustomDurationChange('customShortBreak', v)}
            />
            <DebouncedNumberInput
              label={t('settings.pomodoro.custom.longBreak')}
              value={settings.customLongBreak}
              onChange={(v) => handleCustomDurationChange('customLongBreak', v)}
            />
            <DebouncedNumberInput
              label={t('settings.pomodoro.custom.longBreakEvery')}
              value={settings.longBreakInterval}
              min={2}
              max={10}
              onChange={(v) => handleCustomDurationChange('longBreakInterval', v)}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.pomodoro.custom.workSessionsSuffix')}
            </p>
          </div>
        )}

        {/* Auto-enable Focus Mode */}
        <div className="flex items-center justify-between p-3 border border-border rounded-lg">
          <div className="min-w-0 flex-1 me-3">
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              {t('settings.pomodoro.autoEnableTitle')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('settings.pomodoro.autoEnableDescription')}
            </p>
          </div>
          <Switch
            checked={autoFocus}
            onCheckedChange={async (checked) => {
              if (checked) {
                const granted = await requestFocusSiteAccess();
                if (!granted) {
                  ToastManager.getInstance().error({ key: 'feedback.autoFocusSiteAccessRequired' });
                  return;
                }
              }
              setAutoFocus(checked);
              const current = await Storage.get<FocusSettingsType>('focusSettings');
              await Storage.set('focusSettings', normalizeFocusSettings({ ...current, autoEnableWithPomodoro: checked }));
            }}
            aria-label={t('settings.pomodoro.autoEnableTitle')}
          />
        </div>

        {autoFocus && (
          <div className="flex items-center justify-between p-3 border border-border rounded-lg ms-4">
            <div className="min-w-0 flex-1 me-3">
              <p className="text-sm font-medium text-foreground">
                {t('settings.pomodoro.blockDuringBreaksTitle')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('settings.pomodoro.blockDuringBreaksDescription')}
              </p>
            </div>
            <Switch
              checked={blockDuringBreaks}
              onCheckedChange={async (checked) => {
                setBlockDuringBreaks(checked);
                const current = await Storage.get<FocusSettingsType>('focusSettings');
                await Storage.set('focusSettings', normalizeFocusSettings({ ...current, blockDuringBreaks: checked }));
              }}
              aria-label={t('settings.pomodoro.blockDuringBreaksTitle')}
            />
          </div>
        )}

        {/* Session Sounds */}
        <div>
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <div className="min-w-0 flex-1 me-3">
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5" />
                {t('settings.pomodoro.sessionSoundsTitle')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('settings.pomodoro.sessionSoundsDescription')}
              </p>
            </div>
            <Switch
              checked={soundsEnabled}
              onCheckedChange={async (checked) => {
                setSoundsEnabled(checked);
                await updateSounds({ enabled: checked });
              }}
              aria-label={t('settings.pomodoro.sessionSoundsTitle')}
            />
          </div>

          {soundsEnabled && (
            <div className="mt-2 ms-4 p-3 border border-border rounded-lg space-y-3">
              {/* Work Start */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
                  {t('settings.pomodoro.sounds.workStart')}
                </label>
                <div className="flex items-center gap-2">
                  <Select
                    value={workStartSound}
                    onValueChange={async (v) => {
                      const sound = v as NotificationSound;
                      setWorkStartSound(sound);
                      await updateSounds({ workStart: sound });
                      previewSound(sound);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {soundOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={() => previewSound(workStartSound)}
                    title={t('common.previewSound')}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Short Break */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
                  {t('settings.pomodoro.sounds.shortBreak')}
                </label>
                <div className="flex items-center gap-2">
                  <Select
                    value={shortBreakSound}
                    onValueChange={async (v) => {
                      const sound = v as NotificationSound;
                      setShortBreakSound(sound);
                      await updateSounds({ shortBreak: sound });
                      previewSound(sound);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {soundOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={() => previewSound(shortBreakSound)}
                    title={t('common.previewSound')}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Long Break */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
                  {t('settings.pomodoro.sounds.longBreak')}
                </label>
                <div className="flex items-center gap-2">
                  <Select
                    value={longBreakSound}
                    onValueChange={async (v) => {
                      const sound = v as NotificationSound;
                      setLongBreakSound(sound);
                      await updateSounds({ longBreak: sound });
                      previewSound(sound);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {soundOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={() => previewSound(longBreakSound)}
                    title={t('common.previewSound')}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Today's Summary */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('settings.pomodoro.todaySummary')}
          </h4>
          <div className="flex gap-6 p-3 border border-border rounded-lg bg-gray-50 dark:bg-gray-800/50">
            <div>
              <span dir="ltr" className="text-2xl font-semibold text-foreground">
                {todaySummary.sessionsCompleted}
              </span>
              <span className="text-xs text-muted-foreground ms-1">
                {t('settings.pomodoro.sessionsCompleted', { count: todaySummary.sessionsCompleted })}
              </span>
            </div>
            <div className="border-s border-border" />
            <div>
              <span dir="ltr" className="text-2xl font-semibold text-foreground">
                {todaySummary.totalFocusMinutes}
              </span>
              <span className="text-xs text-muted-foreground ms-1">
                {t('settings.pomodoro.minutesFocus', { count: todaySummary.totalFocusMinutes })}
              </span>
            </div>
          </div>
        </div>

        {/* Session Activity (30-day heatmap) */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('settings.pomodoro.sessionActivity')}
          </h4>
          <PomodoroHeatmap sessions={history} />
        </div>
      </div>
    </div>
  );
}
