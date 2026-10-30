/**
 * @module sidepanel/components/BrainDumpPanel
 *
 * WHY:  Phase 9 ADHD-23 — users need to see every thought they captured
 *       via the Brain Dump shortcut and triage each one: edit it, convert
 *       it into a saved group, set a reminder for it, or delete it. The
 *       Dump tab is the one surface that exposes the Inbox; without it,
 *       captures vanish into storage with no recall path.
 *
 * WHAT: Sidepanel tab content component. Renders:
 *       - Search input to filter entries by substring match
 *       - "Add thought" button that opens an inline dialog (same capture
 *         UX as the content-script modal, but local to the sidepanel —
 *         users already in the sidepanel do not need to leave it)
 *       - Empty state when the Inbox has zero entries (or no matches when
 *         a search query is active)
 *       - Feature-disabled state when Brain Dump is off
 *         (links into Settings). In practice, sidepanel/main.tsx already
 *         hides the Dump tab when the feature is off — this branch is
 *         defensive in case the panel is mounted from another surface.
 *       - A newest-first list of BrainDumpEntry rows with per-entry
 *         3-dot menu actions and inline click-to-edit
 *       - ReminderQuickPicker mount for the convert-to-reminder flow
 *         (the dialog opens with a stub TabGroup built from the entry;
 *         linkless entries create notification-only reminders)
 *
 * HOW:  - Loads entries via BrainDumpService.list() on mount
 *       - Subscribes to chrome.storage.local.onChanged on the Inbox key
 *         so entries added via the content-script modal show up without
 *         a sidepanel reload
 *       - Subscribes to ADHDService changes so the feature-disabled
 *         state stays in sync when the user flips a toggle in settings
 *       - Convert-to-group maps: group name = tabContext.title (fallback
 *         URL hostname, final fallback "Saved from dump"); group note =
 *         thought text; group.tabs = [single tab built from tabContext].
 *         This replaces the earlier "name = first line of text" mapping
 *         which was wrong — the URL/title is the handle users will search
 *         by; the thought is the note attached to it.
 *       - Convert-to-reminder for entries with a URL opens
 *         ReminderQuickPicker with a stub TabGroup that carries the
 *         captured URL. For linkless entries, the picker is handed a
 *         stub and a pre-bound onCreate override that creates a
 *         notification-only reminder (no deep-link) via
 *         ReminderService.create({ notificationOnly: true, ... }).
 *       - Delete calls BrainDumpService.delete; the storage-change
 *         listener refreshes the list.
 *
 * NOT:  - Does not mount NewGroupModal — that modal is for grouping
 *         already-open Chrome tabs; convert-to-group here saves a
 *         Bluetab TabGroup directly.
 *       - Does not register the `brain-dump:restricted-toast` message
 *         listener here — that lives in sidepanel/main.tsx so it fires
 *         regardless of which tab is active.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Clock, Plus, Search, Settings as SettingsIcon, StickyNote } from 'lucide-react';
import { toast } from '@/components/Toast';
import { BrainDumpService } from '@/services/brain-dump-service';
import { Storage } from '@/utils/storage';
import {
  BRAIN_DUMP_INBOX_KEY,
  BRAIN_DUMP_PREFS_KEY,
  type BrainDumpEntry as BrainDumpEntryType,
} from '@/types/adhd';
import type { TabGroup, TabItem } from '@/types/models';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ReminderQuickPicker } from '@/options/components/ReminderQuickPicker';
import { BrainDumpEntry } from './BrainDumpEntry';
import { SearchBar } from './SearchBar';
// Plan 14-07 — Brain Dump destination picker (INTEG-11). Default destination
// is "Bluetab inbox" — no implicit auto-routing. Selecting a connected
// integration routes the saved entry to that integration via dispatchVerb.
import {
  dispatchVerb,
  getBrainDumpDestinations,
  routeBrainDumpToNotionDestination,
  type BrainDumpDestinationOption,
} from '@/services/integration-service';
import {
  getIntegrationUnavailableMessage,
  INTEGRATION_REGISTRY_MAP,
} from '@/services/integrations/registry';
import type { IntegrationId } from '@/services/integrations/registry';
import { useTranslation } from 'react-i18next';

const BLUETAB_INBOX_DEST = 'bluetab-inbox';

interface DestinationOverride {
  integrationId: string;
  accountId: string;
  target?: string | null;
}

/**
 * Derive a group name from an entry with a URL. Order:
 *   1. captured tab title (when present and non-empty after trim)
 *   2. URL hostname
 *   3. fallback literal
 *
 * Exported for direct unit testing — avoids having to render the panel
 * and drive its async load just to verify mapping choices.
 */
export function deriveGroupNameFromEntry(entry: BrainDumpEntryType): string {
  const { tabContext } = entry;
  const title = tabContext?.title?.trim();
  if (title) return title.slice(0, 120);
  if (tabContext?.url) {
    try {
      return new URL(tabContext.url).hostname || 'Saved from dump';
    } catch {
      return 'Saved from dump';
    }
  }
  return 'Saved from dump';
}

/**
 * Pure builder for the Bluetab TabGroup produced by convert-to-group.
 *
 * The source entry MUST have a tabContext.url — linkless entries hide the
 * convert-to-group action in the UI, and this builder will throw if one
 * slips through. The resulting group carries:
 *   - name: tabContext.title | URL hostname | "Saved from dump"
 *   - tabs: single tab built from the captured url/title/favicon
 *   - notes: the dump text (phase-2 group-notes field)
 *
 * Exported for unit testing.
 */
export function buildGroupFromEntry(
  entry: BrainDumpEntryType,
  ids: { groupId: string; tabId: string } = {
    groupId: crypto.randomUUID(),
    tabId: crypto.randomUUID(),
  },
  now: number = Date.now(),
): TabGroup {
  if (!entry.tabContext?.url) {
    throw new Error('buildGroupFromEntry requires entry.tabContext.url');
  }
  const { tabContext } = entry;
  const tab: TabItem = {
    id: ids.tabId,
    url: tabContext.url,
    title: tabContext.title,
    favicon: tabContext.favicon,
    timestamp: entry.createdAt,
    groupId: ids.groupId,
  };
  return {
    id: ids.groupId,
    name: deriveGroupNameFromEntry(entry),
    tabs: [tab],
    notes: entry.text,
    created: now,
    modified: now,
  };
}

/**
 * Case-insensitive filter across the text + tabContext fields of an entry.
 *
 * Post-ship iteration round 2: the filter used to match only `entry.text`,
 * which meant that users searching for a page they had captured (by title
 * or domain) got zero hits unless they had typed those tokens into the
 * thought itself. Extending the match to `tabContext.title` and
 * `tabContext.url` lines search behaviour up with what users expect from a
 * capture-Inbox search surface.
 *
 * Exported so the helper test file can exercise the match rules without
 * rendering the panel.
 */
export function entryMatchesQuery(
  entry: BrainDumpEntryType,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.text.toLowerCase().includes(q)) return true;
  const title = entry.tabContext?.title?.toLowerCase();
  if (title && title.includes(q)) return true;
  const url = entry.tabContext?.url?.toLowerCase();
  if (url && url.includes(q)) return true;
  return false;
}

function buildStubGroupFromEntry(entry: BrainDumpEntryType, fallbackName: string): TabGroup {
  const now = Date.now();
  const groupId = crypto.randomUUID();

  // If the entry has tabContext, use it as a single-tab group. Otherwise
  // synthesize a zero-tab stub — the picker only uses group.name for
  // header copy and group.tabs[].url for targetUrls; for notification-only
  // reminders we want targetUrls to be empty so nothing opens.
  if (entry.tabContext) {
    const tab: TabItem = {
      id: crypto.randomUUID(),
      url: entry.tabContext.url,
      title: entry.tabContext.title,
      favicon: entry.tabContext.favicon,
      timestamp: entry.createdAt,
      groupId,
    };
    return {
      id: groupId,
      name: deriveGroupNameFromEntry(entry),
      tabs: [tab],
      created: entry.createdAt,
      modified: now,
    };
  }

  // Linkless entry — synthesize a zero-tab group carrying the thought
  // text as the name. ReminderQuickPicker's targetUrls derivation
  // becomes []; handleFired will treat this as notification-only when
  // the linkless path overrides onCreate.
  return {
    id: groupId,
    name: entry.text.split('\n')[0].slice(0, 60) || fallbackName,
    tabs: [],
    created: entry.createdAt,
    modified: now,
  };
}

function openSettingsToBrainDump(): void {
  chrome.tabs
    .create({ url: chrome.runtime.getURL('src/settings/index.html#brain-dump') })
    .catch((err) => console.debug('[BlueTab][BrainDumpPanel] open-settings error', err));
}

export function BrainDumpPanel() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<BrainDumpEntryType[]>([]);
  const [featureActive, setFeatureActive] = useState<boolean>(true);
  const [reminderTarget, setReminderTarget] = useState<TabGroup | null>(null);
  // Stash the source entry alongside the stub so we can detect linkless
  // reminders at submit time without re-finding by id.
  const reminderSourceEntryRef = useRef<BrainDumpEntryType | null>(null);
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const addTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Calendar-specific: date/time and duration for calendar destinations.
  // Default start = tomorrow at the same hour (YYYY-MM-DDTHH:MM for datetime-local).
  function tomorrowSameTime(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const [calendarStart, setCalendarStart] = useState(tomorrowSameTime);
  const [calendarDuration, setCalendarDuration] = useState(30);

  // Plan 14-07 — Brain Dump destination picker (INTEG-11). Value is
  // 'bluetab-inbox' or a BrainDumpDestination.key (e.g. "github:acc:owner/repo").
  const [destinationKey, setDestinationKey] = useState<string>(BLUETAB_INBOX_DEST);
  const [destinations, setDestinations] = useState<BrainDumpDestinationOption[]>([]);
  const [unavailableDestinationMessage, setUnavailableDestinationMessage] = useState<string | null>(null);

  const isCalendarDest = destinationKey.startsWith('google-calendar:') || destinationKey.startsWith('outlook-calendar:');

  // Load destinations + saved destinationOverride preference.
  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const [list, prefs] = await Promise.all([
        getBrainDumpDestinations(),
        Storage.get<{ destinationOverride?: DestinationOverride | null }>(BRAIN_DUMP_PREFS_KEY),
      ]);
      if (cancelled) return;
      setDestinations(list);
      const override = prefs?.destinationOverride;
      if (override) {
        const savedKey = override.target
          ? `${override.integrationId}:${override.accountId}:${override.target}`
          : `${override.integrationId}:${override.accountId}`;
        const unavailableMessage = getIntegrationUnavailableMessage(override.integrationId);
        if (unavailableMessage) {
          setDestinationKey(savedKey);
          setUnavailableDestinationMessage(unavailableMessage);
          return;
        }
        if (list.some((d) => d.key === savedKey)) {
          setDestinationKey(savedKey);
          setUnavailableDestinationMessage(null);
          return;
        }
      }
      setDestinationKey(BLUETAB_INBOX_DEST);
      setUnavailableDestinationMessage(null);
    }
    reload();

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.integration_tokens || changes.integration_settings) {
        getBrainDumpDestinations().then((list) => !cancelled && setDestinations(list));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  // Persist destinationOverride whenever the user changes it.
  const handleDestinationChange = useCallback(async (next: string) => {
    setDestinationKey(next);
    setUnavailableDestinationMessage(null);
    try {
      const existing =
        (await Storage.get<{ destinationOverride?: DestinationOverride | null; tabContextDefault?: boolean }>(
          BRAIN_DUMP_PREFS_KEY,
        )) ?? {};
      let nextOverride: DestinationOverride | null = null;
      if (next !== BLUETAB_INBOX_DEST) {
        const parts = next.split(':');
        const integrationId = parts[0];
        const accountId = parts[1];
        const target = parts.length > 2 ? parts.slice(2).join(':') : null;
        nextOverride = { integrationId, accountId, target };
      }
      await Storage.set(BRAIN_DUMP_PREFS_KEY, { ...existing, destinationOverride: nextOverride });
    } catch (err) {
      console.debug('[BlueTab][BrainDumpPanel] destinationOverride persist could not complete', err);
    }
  }, []);

  // Load entries + first-class Brain Dump feature state on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([BrainDumpService.list(), BrainDumpService.isEnabled()]).then(
      ([inbox, active]) => {
        if (cancelled) return;
        setEntries(inbox);
        setFeatureActive(active);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh list on cross-surface Inbox changes (e.g. content-script modal save).
  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      const change = changes[BRAIN_DUMP_INBOX_KEY];
      if (!change) return;
      const next = (change.newValue as BrainDumpEntryType[] | undefined) ?? [];
      setEntries(next);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // Refresh feature-active flag when Brain Dump settings change.
  useEffect(() => {
    const unsubscribe = BrainDumpService.subscribePrefs((prefs) => {
      setFeatureActive(prefs.enabled !== false);
    });
    return unsubscribe;
  }, []);

  // Focus the add-thought textarea when the dialog opens.
  useEffect(() => {
    if (addOpen) {
      // Radix dialog portals asynchronously; schedule focus after mount.
      const t = setTimeout(() => addTextareaRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [addOpen]);

  const handleConvertToGroup = useCallback(async (entry: BrainDumpEntryType) => {
    // Post-ship iteration — convert-to-group only fires for entries that
    // have a URL (BrainDumpEntry hides the menu item otherwise). Defensive
    // guard in case the action is invoked programmatically.
    if (!entry.tabContext?.url) {
      toast.error(t('components.brainDumpPanel.noLink'));
      return;
    }

    const newGroup = buildGroupFromEntry(entry);

    try {
      const existing = (await Storage.get<TabGroup[]>('groups')) ?? [];
      await Storage.set('groups', [...existing, newGroup]);
      // Remove the converted entry from the Inbox (triage is terminal).
      await BrainDumpService.delete(entry.id);
      toast.success(t('components.brainDumpPanel.savedAsGroup', { name: newGroup.name }));
    } catch (err) {
      console.error('[BlueTab][BrainDumpPanel] convert-to-group error', err);
      toast.error(t('components.brainDumpPanel.saveGroupFailed'));
    }
  }, [t]);

  const handleConvertToReminder = useCallback((entry: BrainDumpEntryType) => {
    reminderSourceEntryRef.current = entry;
    setReminderTarget(buildStubGroupFromEntry(entry, t('components.brainDumpPanel.entryAria')));
  }, [t]);

  const handleReminderDialogChange = useCallback((open: boolean) => {
    if (!open) {
      setReminderTarget(null);
      reminderSourceEntryRef.current = null;
    }
  }, []);

  const handleDelete = useCallback(async (entry: BrainDumpEntryType) => {
    try {
      await BrainDumpService.delete(entry.id);
      // Storage-change listener refreshes the list — no explicit setEntries.
    } catch (err) {
      console.error('[BlueTab][BrainDumpPanel] delete error', err);
      toast.error(t('components.brainDumpPanel.deleteFailed'));
    }
  }, [t]);

  const handleSaveEdit = useCallback(
    async (entry: BrainDumpEntryType, nextText: string) => {
      try {
        await BrainDumpService.updateEntry(entry.id, { text: nextText });
        // Storage-change listener refreshes the list.
      } catch (err) {
        console.error('[BlueTab][BrainDumpPanel] update-entry error', err);
        toast.error(t('components.brainDumpPanel.saveEditFailed'));
      }
    },
    [t],
  );

  // When the user picks a time from ReminderQuickPicker, the picker will
  // call ReminderService.create on the stub group. For linkless entries
  // the stub has no URLs, so create would set a reminder that opens no
  // tabs and whose notification body would only say the short summary.
  // To actually fire as notification-only with the FULL thought text, we
  // intercept by providing a custom reminderCreate that the picker can
  // use. Since the existing picker calls ReminderService.create directly
  // we patch the flow here by listening for storage changes on the
  // 'reminders' key — but a cleaner approach is to branch in the
  // onOpenChange: when the picker opens for a linkless entry, we still
  // hand it the stub, but we wrap ReminderService.create briefly so the
  // created reminder carries notificationOnly + notificationBody. That
  // wrapper belongs inside a minor extension to ReminderQuickPicker —
  // instead, here we adopt a simpler ship-it approach: watch reminders
  // storage and, when a new one matches our stub group.id, upgrade it
  // in place to notificationOnly + notificationBody. The picker's
  // existing success toast still fires; we simply patch the record.
  useEffect(() => {
    if (!reminderTarget) return undefined;
    const sourceEntry = reminderSourceEntryRef.current;
    if (!sourceEntry || sourceEntry.tabContext) return undefined;

    // Only linkless entries reach here. Watch for a new reminder with
    // targetId === reminderTarget.id and convert it in place.
    const targetGroupId = reminderTarget.id;
    const thought = sourceEntry.text;

    const listener = async (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      const change = changes.reminders;
      if (!change || !change.newValue) return;
      // Has a reminder for our stub group just been created?
      type ReminderRecord = {
        id: string;
        targetId: string;
        targetUrls: string[];
        notificationOnly?: boolean;
        notificationBody?: string;
      };
      const next = change.newValue as ReminderRecord[];
      const match = next.find((r) => r.targetId === targetGroupId && !r.notificationOnly);
      if (!match) return;
      // Upgrade to notification-only with the full thought body.
      const patched = next.map((r) =>
        r.id === match.id
          ? { ...r, notificationOnly: true, notificationBody: thought, targetUrls: [] }
          : r,
      );
      await Storage.set('reminders', patched);
      console.log(
        '[BlueTab][BrainDumpPanel] Upgraded linkless reminder to notification-only',
      );
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [reminderTarget]);

  const filteredSorted = useMemo(() => {
    const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
    if (!query.trim()) return sorted;
    return sorted.filter((e) => entryMatchesQuery(e, query));
  }, [entries, query]);

  const openAdd = () => {
    setAddDraft('');
    setAddOpen(true);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setAddDraft('');
    setCalendarStart(tomorrowSameTime());
    setCalendarDuration(30);
  };

  const commitAdd = async () => {
    const trimmed = addDraft.trim();
    if (trimmed.length === 0 || isAdding) return;
    const selectedIntegrationId = destinationKey.split(':')[0];
    const unavailableMessage = getIntegrationUnavailableMessage(selectedIntegrationId);
    if (unavailableMessage) {
      toast.error(unavailableMessage);
      return;
    }

    setIsAdding(true);
    try {
      const explicitNotionDestination = destinationKey.startsWith('notion:');
      const inboxAfter = await BrainDumpService.add({
        text: trimmed,
        skipConfiguredRouting: explicitNotionDestination,
      });
      const savedId = inboxAfter[inboxAfter.length - 1]?.id;
      toast.success(t('components.brainDumpPanel.added'));
      closeAdd();

      // Plan 14-07 — INTEG-11. After local save, route to the chosen
      // integration if a non-default destination is selected. This is
      // strictly fire-and-forget — the local Bluetab save always succeeds
      // first; integration push is best-effort and surfaces a toast.
      if (destinationKey !== BLUETAB_INBOX_DEST) {
        const parts = destinationKey.split(':');
        const integrationId = parts[0];
        const accountId = parts[1];
        const target = parts.length > 2 ? parts.slice(2).join(':') : null;
        const entry = INTEGRATION_REGISTRY_MAP.get(integrationId as IntegrationId);
        if (entry) {
          const verb = `push_brain_dump_to_${integrationId.replace('-', '_')}`;
          const args: Record<string, unknown> = { entryId: savedId, text: trimmed };
          // Calendar-specific: pass user-chosen start time and duration.
          if (calendarStart && (integrationId === 'google-calendar' || integrationId === 'outlook-calendar')) {
            args.start_iso = calendarStart;
            args.duration_minutes = calendarDuration;
          }
          if (integrationId === 'github' && target) {
            if (target === 'gist') {
              args.kind = 'gist';
            } else {
              const [owner, repo] = target.split('/');
              args.kind = 'issue';
              args.owner = owner;
              args.repo = repo;
            }
          }
          const operation = integrationId === 'notion'
            ? routeBrainDumpToNotionDestination({ accountId, text: trimmed })
            : dispatchVerb(integrationId as IntegrationId, verb, args, accountId);
          operation
            .then((res) => {
              if (res.success) {
                toast.success(t('notifications.quickSendSuccess', { integration: entry.display_name }));
              } else {
                toast.error(
                  t('options.groupMenu.sendToIntegrationFailed', {
                    integration: entry.display_name,
                    message: res.error ?? t('common.unknownError'),
                  }),
                );
              }
            })
            .catch((err) => {
              const msg = err instanceof Response
                ? `HTTP ${err.status}`
                : err instanceof Error ? err.message : t('common.unknownError');
              toast.error(t('options.groupMenu.sendToIntegrationFailed', {
                integration: entry.display_name,
                message: msg,
              }));
            });
        }
      }
    } catch (err) {
      console.error('[BlueTab][BrainDumpPanel] add-entry error', err);
      toast.error({ key: 'sidepanel.brainDumpPanel.addError' });
    } finally {
      setIsAdding(false);
    }
  };

  // --- Render ------------------------------------------------------------

  if (!featureActive) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center gap-3">
        <StickyNote className="w-10 h-10 text-muted-foreground opacity-60" />
        <p className="text-sm text-foreground">{t('sidepanel.brainDumpPanel.featureOffTitle')}</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          {t('sidepanel.brainDumpPanel.featureOffDescription')}
        </p>
        <button
          type="button"
          onClick={openSettingsToBrainDump}
          className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full border border-border text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          {t('sidepanel.brainDumpPanel.openSettings')}
        </button>
      </div>
    );
  }

  const controlBar = (
    <div className="sticky top-0 z-10 flex items-center gap-2 p-2 bg-bg-0/90 backdrop-blur-md border-b border-border">
      <div className="flex-1">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder={t('sidepanel.brainDumpPanel.searchPlaceholder')}
          autoFocus={false}
          ariaLabel={t('sidepanel.brainDumpPanel.searchAria')}
        />
      </div>
      <Button
        onClick={openAdd}
        size="sm"
        className="h-8 text-xs gap-1"
        title={t('sidepanel.brainDumpPanel.addThoughtTitle')}
      >
        <Plus className="w-3 h-3" />
        {t('sidepanel.brainDumpPanel.newDump')}
      </Button>
    </div>
  );

  const addDialog = (
    <Dialog open={addOpen} onOpenChange={(v) => (v ? setAddOpen(true) : closeAdd())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="w-5 h-5" />
            {t('sidepanel.brainDumpPanel.addToDump')}
          </DialogTitle>
          <DialogDescription>
            {t('brainDumpModal.hint')}
          </DialogDescription>
        </DialogHeader>

        {/* Plan 14-07 — Brain Dump destination picker (INTEG-11).
             Default is "Bluetab inbox". Connected integrations × accounts
             list below. Default behavior never auto-routes. */}
        {(destinations.length > 0 || unavailableDestinationMessage) && (
          <div className="mt-2 space-y-1">
            <label
              htmlFor="brain-dump-destination"
              className="text-xs font-medium text-foreground"
            >
              {t('brainDumpModal.saveTo')}
            </label>
            <select
              id="brain-dump-destination"
              value={destinationKey}
              onChange={(e) => void handleDestinationChange(e.target.value)}
              disabled={isAdding}
              className="w-full h-8 text-xs rounded-md border border-border-glass bg-glass-bg backdrop-blur-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary [&>option]:bg-[hsl(var(--bg-1))] [&>option]:text-foreground"
            >
              <option value={BLUETAB_INBOX_DEST}>{t('brainDumpModal.inbox')}</option>
              {unavailableDestinationMessage && (
                <option value={destinationKey} disabled>
                  {unavailableDestinationMessage}
                </option>
              )}
              {destinations.map((d) => {
                return (
                  <option
                    key={d.key}
                    value={d.key}
                  >
                    {d.label}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div className="mt-2">
          <textarea
            ref={addTextareaRef}
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void commitAdd();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeAdd();
              }
            }}
            placeholder={t('brainDumpModal.textareaPlaceholder')}
            disabled={isAdding}
            aria-label={t('brainDumpModal.textareaAria')}
            className="w-full min-h-[120px] p-3 rounded-lg border border-border bg-bg-0 text-sm text-text-strong placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
          />
        </div>

        {/* Calendar-specific: date/time picker + duration when destination is a calendar */}
        {isCalendarDest && (
          <div className="mt-2 space-y-2 p-3 rounded-lg border border-border bg-bg-1/40">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Calendar className="w-3.5 h-3.5" />
              {t('brainDumpModal.eventTiming')}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 space-y-1">
                <label htmlFor="cal-start" className="text-caption text-muted-foreground">{t('brainDumpModal.start')}</label>
                <input
                  id="cal-start"
                  type="datetime-local"
                  value={calendarStart}
                  onChange={(e) => setCalendarStart(e.target.value)}
                  disabled={isAdding}
                  className="w-full h-8 text-xs rounded-md border border-border bg-bg-1/60 px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary [color-scheme:dark]"
                />
              </div>
              <div className="w-24 space-y-1">
                <label htmlFor="cal-duration" className="text-caption text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {t('brainDumpModal.duration')}
                </label>
                <select
                  id="cal-duration"
                  value={calendarDuration}
                  onChange={(e) => setCalendarDuration(Number(e.target.value))}
                  disabled={isAdding}
                  className="w-full h-8 text-xs rounded-md border border-border bg-bg-1/60 px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary [&>option]:bg-[hsl(var(--bg-1))] [&>option]:text-foreground"
                >
                  <option value={15}>{t('brainDumpModal.duration15m')}</option>
                  <option value={30}>{t('brainDumpModal.duration30m')}</option>
                  <option value={45}>{t('brainDumpModal.duration45m')}</option>
                  <option value={60}>{t('brainDumpModal.duration1h')}</option>
                  <option value={90}>{t('brainDumpModal.duration1_5h')}</option>
                  <option value={120}>{t('brainDumpModal.duration2h')}</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={closeAdd}
            disabled={isAdding}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void commitAdd()}
            disabled={isAdding || addDraft.trim().length === 0}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.save')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (entries.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {controlBar}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <StickyNote className="w-10 h-10 text-muted-foreground opacity-60" />
          <p className="text-sm text-foreground">{t('sidepanel.brainDumpPanel.emptyTitle')}</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            {t('sidepanel.brainDumpPanel.emptyDescription')}
          </p>
        </div>
        {addDialog}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {controlBar}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filteredSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center gap-2">
            <Search className="w-6 h-6 text-muted-foreground opacity-60" />
            <p className="text-xs text-muted-foreground">
              {t('sidepanel.brainDumpPanel.noMatches', { query })}
            </p>
          </div>
        ) : (
          filteredSorted.map((entry) => (
            <BrainDumpEntry
              key={entry.id}
              entry={entry}
              onConvertToGroup={handleConvertToGroup}
              onConvertToReminder={handleConvertToReminder}
              onDelete={handleDelete}
              onSave={handleSaveEdit}
            />
          ))
        )}
      </div>

      {reminderTarget && (
        <ReminderQuickPicker
          open={reminderTarget !== null}
          onOpenChange={handleReminderDialogChange}
          group={reminderTarget}
        />
      )}
      {addDialog}
    </div>
  );
}
