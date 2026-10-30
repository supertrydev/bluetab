/**
 * @module options/components/StatsDashboard
 *
 * WHY:  Users need a way to see their tab usage patterns over time —
 *       how many tabs they've saved, which domains they visit most,
 *       and how their Pomodoro focus sessions relate to browsing activity.
 *
 * WHAT: Craft.do-inspired statistics dashboard with glass metric cards,
 *       trend indicators, SVG bar chart, top sites with favicons,
 *       pill period switcher, and hero section.
 *
 * HOW:  - Loads data from StatsService, PomodoroService, and getStorageUsage
 *       - Computes retroactive baseline on first visit if not yet done
 *       - Fetches 2x period for trend comparison (current vs previous)
 *       - Pure SVG chart — no charting library
 *       - Radix Tabs with pill styling for period switching
 *
 * NOT:  Does not write stats — that is the service worker's job via StatsService.
 *       Does not manage opt-out — that is StatsSettings in the settings page.
 */

import { useState, useEffect, useCallback } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  BarChart2,
  Globe,
  Layers,
  MousePointerClick,
  Timer,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatsService } from '@/services/stats-service';
import { PomodoroService } from '@/services/pomodoro-service';
import { Storage } from '@/utils/storage';
import type { DailyStats } from '@/types/stats';
import type { PomodoroSession } from '@/types/productivity';
import type { TabGroup } from '@/types/models';
import { getLocaleTag, t as translate } from '@/i18n';
import { formatHourOfDay, getLocaleWeekInfo } from '@/i18n/format';
import { resolveDomainDisplayTitle } from './stats-display';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'day' | 'week' | 'month' | 'year';

interface AggregateResult {
  totalCreated: number;
  totalRemoved: number;
  totalActivated: number;
  topDomains: { domain: string; count: number }[];
  totalGroupsSaved: number;
}

interface Trend {
  value: number; // percentage change
  label: string; // e.g. "from yesterday"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPeriodDays(period: Period): number {
  return period === 'day' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : 365;
}

/** Get the start-of-period ISO date string (local timezone). */
function getPeriodStartIso(period: Period): string {
  const now = new Date();
  if (period === 'day') {
    return toLocalIso(now);
  }
  if (period === 'week') {
    return toLocalIso(getStartOfWeek(now));
  }
  if (period === 'month') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }
  // year
  return `${now.getFullYear()}-01-01`;
}

function getPeriodLabel(period: Period): string {
  return period === 'day'
    ? translate('options.stats.trend.yesterday')
    : period === 'week'
      ? translate('options.stats.trend.lastWeek')
      : period === 'month'
        ? translate('options.stats.trend.lastMonth')
        : translate('options.stats.trend.lastYear');
}

function calcTrend(current: number, previous: number, label: string): Trend | undefined {
  if (previous === 0 && current === 0) return undefined;
  if (previous === 0) return { value: 100, label };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return undefined;
  return { value: pct, label };
}

const MAX_TOP_DOMAINS = 10;

/**
 * Phase 12 (ADHD-27): Format labeled session counts for display.
 *
 * Rules (from CONTEXT.md §Flowtime Timer §decisions "Honest Flowtime stats model"):
 *   - If both modes have non-zero counts: "N Pomodoro(s) · M Flowtime(s)"
 *   - If only one mode is non-zero: show that mode only (hide-when-zero)
 *   - If both zero: return null (caller shows "--" per Phase 7 Wrapped precedent)
 *
 * Singular/plural: 1 Pomodoro / N Pomodoros; 1 Flowtime / N Flowtimes.
 *
 * @returns formatted string or null (if both counts are 0)
 */
export function formatSessionCounts(pomodoro: number, flowtime: number): string | null {
  if (pomodoro === 0 && flowtime === 0) return null;

  const pomodoroStr = pomodoro > 0
    ? translate('options.stats.sessionCount.pomodoro', { count: pomodoro })
    : null;
  const flowtimeStr = flowtime > 0
    ? translate('options.stats.sessionCount.flowtime', { count: flowtime })
    : null;

  return [pomodoroStr, flowtimeStr].filter(Boolean).join(' · ');
}

function buildAggregate(entries: DailyStats[]): AggregateResult {
  let totalCreated = 0;
  let totalRemoved = 0;
  let totalActivated = 0;
  let totalGroupsSaved = 0;
  const domainMap: Record<string, number> = {};

  for (const entry of entries) {
    totalCreated += entry.tabsCreated;
    totalRemoved += entry.tabsRemoved;
    totalActivated += entry.tabsActivated;
    totalGroupsSaved += entry.groupsSaved;
    for (const [domain, count] of Object.entries(entry.domainCounts)) {
      domainMap[domain] = (domainMap[domain] ?? 0) + count;
    }
  }

  const topDomains = Object.entries(domainMap)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TOP_DOMAINS);

  return { totalCreated, totalRemoved, totalActivated, topDomains, totalGroupsSaved };
}

interface ChartSlot {
  label: string;
  fullLabel: string;
  value: number;
}

/** First day of the week containing `date`, using the locale's week rules. */
function getStartOfWeek(date: Date): Date {
  const { firstDay } = getLocaleWeekInfo();
  const start = new Date(date);
  start.setDate(date.getDate() - ((date.getDay() - firstDay + 7) % 7));
  return start;
}

/** Format a Date as YYYY-MM-DD in local timezone (not UTC). */
function toLocalIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildChartData(stats: DailyStats[], period: Period): ChartSlot[] {
  const now = new Date();
  const statsMap = new Map(stats.map((s) => [s.date, s]));
  const localeTag = getLocaleTag();

  if (period === 'day') {
    // 24 hourly slots using real hourlyCounts data
    const todayIso = toLocalIso(now);
    const entry = statsMap.get(todayIso);
    const hourly = entry?.hourlyCounts;
    const currentHour = now.getHours();
    // Hour labels follow the locale and Settings > Time format ("09:00" / "9:00 AM").
    return Array.from({ length: 24 }, (_, h) => ({
      label: h % 4 === 0 ? formatHourOfDay(h) : '',
      fullLabel: formatHourOfDay(h),
      value: h <= currentHour ? (hourly?.[h] ?? 0) : 0,
    }));
  }

  if (period === 'week') {
    // 7 slots from the locale's first day of the week (Monday in tr/en-GB,
    // Sunday in en-US, Saturday in many Arabic regions).
    const monday = getStartOfWeek(now);
    monday.setHours(0, 0, 0, 0);
    const todayIso = toLocalIso(now);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = toLocalIso(d);
      const isFuture = iso > todayIso;
      const entry = !isFuture ? statsMap.get(iso) : undefined;
      return {
        label: new Intl.DateTimeFormat(localeTag, { weekday: 'short' }).format(d),
        fullLabel: d.toLocaleDateString(localeTag, { weekday: 'long', month: 'short', day: 'numeric' }),
        value: entry ? entry.tabsCreated + entry.tabsActivated : 0,
      };
    });
  }

  if (period === 'month') {
    // Days in current month
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayIso = toLocalIso(now);
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month, i + 1);
      const iso = toLocalIso(d);
      const isFuture = iso > todayIso;
      const entry = !isFuture ? statsMap.get(iso) : undefined;
      return {
        label: (i + 1) % 5 === 1 ? `${i + 1}` : '',
        fullLabel: d.toLocaleDateString(localeTag, { month: 'short', day: 'numeric' }),
        value: entry ? entry.tabsCreated + entry.tabsActivated : 0,
      };
    });
  }

  // Year: 12 equal slots (months), aggregate daily stats per month
  const year = now.getFullYear();
  const currentMonth = now.getMonth();
  return Array.from({ length: 12 }, (_, m) => {
    let total = 0;
    if (m <= currentMonth) {
      for (const [date, entry] of statsMap) {
        const d = new Date(date);
        if (d.getFullYear() === year && d.getMonth() === m) {
          total += entry.tabsCreated + entry.tabsActivated;
        }
      }
    }
    const monthDate = new Date(year, m, 1);
    const monthLabel = new Intl.DateTimeFormat(localeTag, { month: 'short' }).format(monthDate);
    return {
      label: monthLabel,
      fullLabel: new Intl.DateTimeFormat(localeTag, { month: 'long', year: 'numeric' }).format(monthDate),
      value: total,
    };
  });
}

function sumStats(entries: DailyStats[]): { created: number; activated: number; groupsSaved: number } {
  let created = 0, activated = 0, groupsSaved = 0;
  for (const e of entries) {
    created += e.tabsCreated;
    activated += e.tabsActivated;
    groupsSaved += e.groupsSaved;
  }
  return { created, activated, groupsSaved };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  trend,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext?: string;
  trend?: Trend;
}) {
  return (
    <div className="relative rounded-2xl bg-glass-bg backdrop-blur-md border border-border-glass p-6 space-y-3 hover-lift transition-all duration-300 overflow-hidden">
      {/* Icon — top right, subtle */}
      <Icon className="absolute top-5 end-5 w-5 h-5 text-muted-foreground/25" />

      {/* Label */}
      <p className="text-caption font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>

      {/* Value */}
      <p dir="auto" className="text-3xl font-bold font-mono text-text-strong tabular-nums">
        {typeof value === 'number' ? value.toLocaleString(getLocaleTag()) : value}
      </p>

      {/* Trend + Subtext */}
      <div className="flex items-center gap-2 min-h-[18px]">
        {trend && (
          <span className={cn(
            'flex items-center gap-0.5 text-xs font-medium',
            trend.value > 0 ? 'text-green-500' : trend.value < 0 ? 'text-red-400' : 'text-muted-foreground'
          )}>
            {trend.value > 0 ? <TrendingUp className="w-3 h-3" /> : trend.value < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {trend.value > 0 ? '+' : ''}{trend.value}%
            <span className="text-muted-foreground font-normal ms-0.5">{trend.label}</span>
          </span>
        )}
        {!trend && subtext && (
          <span className="text-xs text-muted-foreground">{subtext}</span>
        )}
      </div>
    </div>
  );
}

function ActivityChart({ data }: { data: ChartSlot[] }) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const n = data.length;
  const gapPx = n <= 7 ? 4 : n <= 12 ? 3 : n <= 24 ? 2 : 1;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div dir="ltr" className="flex-1 flex flex-col overflow-hidden relative">
      {/* Tooltip */}
      {hoveredIdx !== null && (
        <div className="absolute top-0 right-0 px-2.5 py-1.5 rounded-lg bg-bg-1/95 backdrop-blur-sm border border-border-glass text-xs shadow-md z-10">
          <span className="text-muted-foreground">{data[hoveredIdx].fullLabel}</span>
          <span className="ml-2 font-mono font-semibold text-text-strong">{data[hoveredIdx].value}</span>
          <span className="ml-1 text-muted-foreground">{translate('options.stats.tabsUnit')}</span>
        </div>
      )}

      {/* Horizontal bars — each row: label | bar | value */}
      <div className="flex-1 flex flex-col justify-between" style={{ gap: `${gapPx}px` }}>
        {data.map((d, i) => {
          const pct = d.value === 0 ? 0 : Math.max(3, (d.value / maxValue) * 100);
          return (
            <div
              key={`row-${i}`}
              className="flex items-center gap-2 cursor-pointer group"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Label */}
              <span className="w-10 text-micro text-muted-foreground text-right shrink-0 tabular-nums">
                {d.label}
              </span>
              {/* Bar */}
              <div className="flex-1 flex items-center">
                <div
                  className={cn(
                    'rounded-r-sm transition-all duration-200',
                    d.value === 0 ? 'bg-[hsl(220,10%,25%)]' : hoveredIdx === i ? 'bg-primary' : 'bg-[hsl(226,68%,50%)]',
                  )}
                  style={{
                    width: d.value === 0 ? '2px' : `${pct}%`,
                    height: n <= 12 ? '12px' : n <= 24 ? '6px' : '4px',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StatsDashboard({
  sidebarTrigger,
}: {
  sidebarTrigger: React.ReactNode;
}) {
  const [stats, setStats] = useState<DailyStats[]>([]);
  const [prevStats, setPrevStats] = useState<DailyStats[]>([]);
  const [aggregate, setAggregate] = useState<AggregateResult | null>(null);
  const [pomodoroHistory, setPomodoroHistory] = useState<PomodoroSession[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOptedOut, setIsOptedOut] = useState(false);

  const loadData = useCallback(async (currentPeriod: Period) => {
    setIsLoading(true);
    try {
      setIsOptedOut(await StatsService.isOptedOut());
      const periodStart = getPeriodStartIso(currentPeriod);
      // Fetch enough raw data to cover current + previous period for trend comparison
      const days = getPeriodDays(currentPeriod);
      const [rawStats, history, storedGroups] = await Promise.all([
        StatsService.getDailyStats(days * 2),
        PomodoroService.getHistory(),
        Storage.get<TabGroup[]>('groups'),
      ]);

      // Current period: entries >= periodStart
      const dailyStats = rawStats.filter((d) => d.date >= periodStart);
      // Previous period: entries before periodStart
      const prev = rawStats.filter((d) => d.date < periodStart);

      // Build aggregate from current period entries (not raw)
      const aggregateResult = buildAggregate(dailyStats);

      setStats(dailyStats);
      setPrevStats(prev);
      setAggregate(aggregateResult);
      setPomodoroHistory(history);
      setGroups(storedGroups || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const state = await StatsService.getState();
      if (!state.baselineComputed) {
        const storedGroups = (await Storage.get<TabGroup[]>('groups')) || [];
        await StatsService.computeRetroactiveBaseline(storedGroups);
      }
      await loadData(period);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [didInit, setDidInit] = useState(false);
  useEffect(() => {
    if (!didInit) { setDidInit(true); return; }
    loadData(period);
  }, [period, loadData, didInit]);

  // Derived values
  const totalTabs = groups.reduce((sum, g) => sum + g.tabs.length, 0);
  const activeGroups = groups.length;
  const topDomain = aggregate?.topDomains[0]?.domain ?? '—';
  const topDomainCount = aggregate?.topDomains[0]?.count;
  const topSiteTitle = topDomain === '—'
    ? translate('options.stats.noData')
    : resolveDomainDisplayTitle(topDomain, groups);

  const today = toLocalIso(new Date());
  const yDate = new Date(); yDate.setDate(yDate.getDate() - 1);
  const yesterday = toLocalIso(yDate);
  const todayEntry = stats.find((s) => s.date === today);
  const yesterdayEntry = stats.find((s) => s.date === yesterday);
  const tabsToday = todayEntry ? todayEntry.tabsCreated : 0;
  const tabsYesterday = yesterdayEntry ? yesterdayEntry.tabsCreated : 0;

  const periodMs = getPeriodDays(period) * 24 * 60 * 60 * 1000;
  // Phase 12 (ADHD-27): Partition by mode discriminator.
  // Existing sessions without `mode` field default to 'pomodoro' (backward compat).
  // Focus minutes remain mode-agnostic (both modes contribute equally).
  const workInPeriod = pomodoroHistory.filter(
    (s) => s.type === 'work' && s.completedAt >= Date.now() - periodMs,
  );
  const pomodoroInPeriod = workInPeriod.filter(
    (s) => (s.mode ?? 'pomodoro') === 'pomodoro',
  );
  const flowtimeInPeriod = workInPeriod.filter(
    (s) => s.mode === 'flowtime',
  );
  // Keep the combined count for trend comparison (total work sessions)
  const allWorkInPeriod = workInPeriod;
  const allWorkInPrev = pomodoroHistory.filter(
    (s) => s.type === 'work' && s.completedAt >= Date.now() - periodMs * 2 && s.completedAt < Date.now() - periodMs,
  );
  // allWorkInPrev used for trend comparison; pomodoroInPrev alias removed (ADHD-27 refactor)

  // Trend calculations
  const currentSum = sumStats(stats);
  const prevSum = sumStats(prevStats);
  const trendLabel = getPeriodLabel(period);

  const chartData = buildChartData(stats, period);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center gap-2 border-b border-border-glass px-4 bg-glass-bg backdrop-blur-md">
        {sidebarTrigger}
        <div className="flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-text-strong">{translate('options.stats.title')}</h1>
            <p className="text-xs text-text-muted">{translate('options.stats.subtitle')}</p>
          </div>
        </div>
      </header>

      {isOptedOut && (
        <div className="mx-6 sm:mx-8 mt-4 flex items-center gap-3 p-3 rounded-lg bg-warning-muted border border-warning/30 text-sm">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
          <div>
            <p className="font-medium text-warning">{translate('options.stats.trackingDisabledTitle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {translate('options.stats.trackingDisabledDescriptionPrefix')}{' '}
              <a
                href={chrome.runtime.getURL('src/settings/index.html')}
                className="text-primary underline hover:no-underline"
              >
                {translate('options.stats.settingsLink')}
              </a>{' '}
              {translate('options.stats.trackingDisabledDescriptionSuffix')}
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 p-6 sm:p-8 space-y-8 bg-background">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            {translate('options.stats.loading')}
          </div>
        ) : (
          <>
            {/* Hero Section */}
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-text-strong">{translate('options.stats.heroTitle')}</h2>
              <p className="text-sm text-muted-foreground max-w-lg leading-relaxed">
                {translate('options.stats.heroDescription')}
              </p>
            </div>

            {/* Metric Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <StatCard
                icon={Layers}
                label={translate('options.stats.cards.totalTabsSaved')}
                value={totalTabs}
                subtext={translate('options.stats.acrossGroups', { count: activeGroups })}
              />
              <StatCard
                icon={Layers}
                label={translate('options.stats.cards.activeGroups')}
                value={activeGroups}
                subtext={translate('options.stats.organizedWorkspaces')}
              />
              <StatCard
                icon={Timer}
                label={translate('options.stats.cards.focusTime')}
                value={(() => {
                  const focusMins = stats.reduce((s, d) => s + (d.focusMinutes ?? 0), 0);
                  if (focusMins < 60) return translate('options.stats.focusMinutesShort', { count: focusMins });
                  const h = Math.floor(focusMins / 60);
                  const m = focusMins % 60;
                  return m > 0
                    ? translate('options.stats.focusHoursMinutes', { hours: h, minutes: m })
                    : translate('options.stats.focusHours', { hours: h });
                })()}
                trend={calcTrend(
                  stats.reduce((s, d) => s + (d.focusMinutes ?? 0), 0),
                  prevStats.reduce((s, d) => s + (d.focusMinutes ?? 0), 0),
                  trendLabel
                )}
              />
              <StatCard
                icon={Globe}
                label={translate('options.stats.cards.topSite')}
                value={topSiteTitle}
                subtext={topDomainCount !== undefined ? translate('options.stats.visits', { count: topDomainCount }) : undefined}
              />
              <StatCard
                icon={MousePointerClick}
                label={translate('options.stats.cards.tabsOpenedToday')}
                value={tabsToday}
                trend={calcTrend(tabsToday, tabsYesterday, translate('options.stats.trend.fromYesterday'))}
              />
              <StatCard
                icon={Zap}
                label={translate('options.stats.cards.tabActions')}
                value={currentSum.created + currentSum.activated}
                trend={calcTrend(
                  currentSum.created + currentSum.activated,
                  prevSum.created + prevSum.activated,
                  trendLabel
                )}
              />
              <StatCard
                icon={Timer}
                label={translate('options.stats.cards.focusSessions')}
                value={(() => {
                  // Phase 12 (ADHD-27): labeled mode counts with hide-when-zero rule.
                  // formatSessionCounts returns null when both are 0 → show "--".
                  const labeled = formatSessionCounts(pomodoroInPeriod.length, flowtimeInPeriod.length);
                  return labeled ?? translate('options.stats.noData');
                })()}
                trend={calcTrend(allWorkInPeriod.length, allWorkInPrev.length, trendLabel)}
                subtext={
                  !calcTrend(allWorkInPeriod.length, allWorkInPrev.length, trendLabel)
                    ? translate('options.stats.focusMinutesLong', { count: allWorkInPeriod.reduce((s, p) => s + p.duration, 0) })
                    : undefined
                }
              />
              <StatCard
                icon={Layers}
                label={translate('options.stats.cards.groupsSaved')}
                value={currentSum.groupsSaved}
                trend={calcTrend(currentSum.groupsSaved, prevSum.groupsSaved, trendLabel)}
              />
            </div>

            {/* Pill Period Switcher */}
            <Tabs.Root value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <div className="flex justify-center">
                <Tabs.List className="inline-flex gap-1 rounded-full bg-muted/30 p-1">
                  {(['day', 'week', 'month', 'year'] as Period[]).map((p) => (
                    <Tabs.Trigger
                      key={p}
                      value={p}
                      className="px-5 py-1.5 text-sm font-medium capitalize rounded-full transition-all duration-300 text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm"
                    >
                      {translate(`options.stats.periods.${p}`)}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </div>

              {(['day', 'week', 'month', 'year'] as Period[]).map((p) => (
                <Tabs.Content key={p} value={p} className="mt-6">
                  {/* Chart + Domains side by side */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Activity Chart */}
                    <div className="rounded-2xl bg-glass-bg backdrop-blur-md border border-border-glass p-6 flex flex-col min-h-[320px]">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-sm font-semibold text-text-strong">{translate('options.stats.dailyTabActivity')}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {translate(`options.stats.activityDescriptions.${period}`)}
                          </p>
                        </div>
                      </div>
                      {chartData.every((d) => d.value === 0) ? (
                        <p className="text-sm text-muted-foreground py-12 text-center">
                          {translate('options.stats.noActivity')}
                        </p>
                      ) : (
                        <ActivityChart data={chartData} />
                      )}
                    </div>

                    {/* Top Sites */}
                    <div className="rounded-2xl bg-glass-bg backdrop-blur-md border border-border-glass p-6">
                      <div className="mb-4">
                        <h3 className="text-sm font-semibold text-text-strong">{translate('options.stats.topSites')}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {translate(`options.stats.topSiteDescriptions.${period}`)}
                        </p>
                      </div>
                      {aggregate && aggregate.topDomains.length > 0 ? (
                        <div className="space-y-3">
                          {aggregate.topDomains.map((d) => {
                            const maxCount = aggregate.topDomains[0].count;
                            const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                            return (
                              <div key={d.domain} className="space-y-1.5">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="flex items-center gap-2 text-text-strong font-medium">
                                      <img
                                          src={`https://www.google.com/s2/favicons?domain=${d.domain}&sz=16`}
                                          alt=""
                                          className="w-4 h-4 rounded-sm"
                                          onError={(e) => { e.currentTarget.style.display = 'none' }}
                                        />
                                        <bdi dir="auto">{resolveDomainDisplayTitle(d.domain, groups)}</bdi>
                                      </span>
                                      <span dir="ltr" className="text-muted-foreground font-mono text-xs tabular-nums">
                                        {d.count}
                                  </span>
                                </div>
                                <div className="bg-muted/40 rounded-full h-1 overflow-hidden">
                                  <div
                                    className="bg-primary/70 h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground py-12 text-center">
                          {translate('options.stats.noSiteData')}
                        </p>
                      )}
                    </div>
                  </div>
                </Tabs.Content>
              ))}
            </Tabs.Root>
          </>
        )}
      </div>
    </div>
  );
}
