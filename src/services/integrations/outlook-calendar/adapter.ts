import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { executeProviderRequest } from '../cloud-operation-client';
import { normalizeEventDateTime } from '../calendar-date-time';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function resolveCalendarId(accountMeta: Record<string, string>, override?: string): string {
  return override
    || accountMeta.default_target
    || accountMeta.calendar_id
    || '';  // empty = primary calendar (POST /me/events)
}

function eventsUrl(calendarId: string): string {
  if (!calendarId) return `${GRAPH_BASE}/me/events`;
  return `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events`;
}

type OutlookEventResponse = {
  id?: string;
  webLink?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  accessToken: string,
  calendarId: string,
): Promise<T> {
  const response = await executeProviderRequest(
    accessToken,
    'outlook-calendar.event.create',
    { ...(calendarId ? { calendarId } : {}), body },
    () => fetch(url, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
    }),
  );
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as T;
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await executeProviderRequest(accessToken, 'outlook-calendar.calendars.list', {}, () => fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
  if (!response.ok) throw response;
  return (await response.json()) as T;
}

function buildEventBody(
  args: Record<string, unknown>,
  accountMeta: Record<string, string>
): Record<string, unknown> {
  const subject = asString(args.subject);
  const start = asString(args.start);
  const end = asString(args.end);
  const startIso = start && normalizeEventDateTime(start);
  const endIso = end && normalizeEventDateTime(end);
  if (!subject) {
    throw new Error('missing_subject');
  }
  if (!startIso) {
    throw new Error('missing_start');
  }
  if (!endIso) {
    throw new Error('missing_end');
  }

  // Account zone first. Without one: a time that carries Z/an offset is an
  // exact instant, so UTC is correct; a bare local time ("2026-05-01T14:00")
  // was meant in the user's zone, not UTC.
  const timeZone = accountMeta.timezone
    || (hasExplicitOffset(startIso) ? 'UTC' : getBrowserTimeZone());
  const content = asString(args.body) ?? asString(args.description) ?? '';
  const locationName = asString(args.location);

  return omitUndefined({
    subject,
    body: { contentType: 'HTML', content },
    start: { dateTime: startIso, timeZone },
    end: { dateTime: endIso, timeZone },
    location: locationName ? { displayName: locationName } : undefined,
  });
}

async function createEvent(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ eventId?: string; eventUrl?: string }> {
  const calendarId = resolveCalendarId(accountMeta, asString(args.calendar_id));
  const body = buildEventBody(args, accountMeta);
  const event = await postJson<OutlookEventResponse>(eventsUrl(calendarId), body, accessToken, calendarId);
  return { eventId: event.id, eventUrl: event.webLink };
}

async function scheduleTabAsEvent(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ eventId?: string; eventUrl?: string }> {
  const tabTitle = asString(args.tabTitle);
  const tabUrl = asString(args.tabUrl);
  const whenIso = asString(args.when_iso);
  if (!tabTitle) {
    throw new Error('missing_tab_title');
  }
  if (!tabUrl) {
    throw new Error('missing_tab_url');
  }
  if (!whenIso) {
    throw new Error('missing_when_iso');
  }

  const durationMinutes = asNumber(args.duration_minutes) ?? 30;
  const endIso = new Date(new Date(whenIso).getTime() + durationMinutes * 60_000).toISOString();
  const tabNotes = asString(args.tabNotes);
  const description = tabNotes ? `${tabUrl}\n\n${tabNotes}` : tabUrl;

  return createEvent(
    {
      subject: tabTitle,
      body: description,
      start: whenIso,
      end: endIso,
    },
    accessToken,
    accountMeta
  );
}

async function pushBrainDumpToOutlookCalendar(
  args: Record<string, unknown>,
  accessToken: string,
  accountMeta: Record<string, string>
): Promise<{ eventId?: string; eventUrl?: string }> {
  const entryId = asString(args.entryId);
  if (!entryId) throw new Error('missing_entry_id');

  const entries = await BrainDumpService.list();
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) throw new Error('entry_not_found');

  // If the caller supplies a start time and duration, use them.
  // Otherwise fall back to the remind-me pattern: 1 hour from now, 15 minutes.
  const userStartIso = asString(args.start_iso);
  const durationMinutes = asNumber(args.duration_minutes) ?? 15;

  let startMs: number;
  if (userStartIso) {
    startMs = new Date(userStartIso).getTime();
    if (Number.isNaN(startMs)) {
      throw new Error('invalid_start_iso');
    }
  } else {
    startMs = Date.now() + 60 * 60_000;
  }
  const endMs = startMs + durationMinutes * 60_000;

  const text = asString(args.text) || entry.text;
  const subject = text.split('\n')[0].slice(0, 100) || 'Brain dump';
  const tabUrl = entry.tabContext?.url;
  const body = tabUrl ? `${text}\n\n${tabUrl}` : text;

  return createEvent(
    {
      subject,
      body,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    },
    accessToken,
    accountMeta,
  );
}

export const adapter: IntegrationAdapter = {
  async executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      switch (verb) {
        case 'create_event':
          return { success: true, result: await createEvent(args, accessToken, accountMeta) };
        case 'schedule_tab_as_event':
          return {
            success: true,
            result: await scheduleTabAsEvent(args, accessToken, accountMeta),
          };
        case 'push_brain_dump_to_outlook_calendar':
          return {
            success: true,
            result: await pushBrainDumpToOutlookCalendar(args, accessToken, accountMeta),
          };
        default:
          return { success: false, error: 'unknown_verb' };
      }
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export interface OutlookCalendarSummary {
  id: string;
  name: string;
  isDefaultCalendar?: boolean;
  color?: string;
  canEdit?: boolean;
}

type OutlookCalendarListResponse = {
  value?: Array<{
    id?: string;
    name?: string;
    isDefaultCalendar?: boolean;
    color?: string;
    canEdit?: boolean;
  }>;
};

export async function fetchCalendars(accessToken: string): Promise<OutlookCalendarSummary[]> {
  // Only return calendars the user can write to.
  const url = `${GRAPH_BASE}/me/calendars?$select=id,name,isDefaultCalendar,color,canEdit`;
  const data = await getJson<OutlookCalendarListResponse>(url, accessToken);
  const items = data.value ?? [];
  return items
    .filter(item => item.id && item.name && item.canEdit !== false)
    .map(item => ({
      id: item.id!,
      name: item.name!,
      isDefaultCalendar: item.isDefaultCalendar,
      color: item.color,
      canEdit: item.canEdit,
    }));
}

function hasExplicitOffset(iso: string): boolean {
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso.trim());
}

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
