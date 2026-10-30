import * as fs from 'fs';
import * as path from 'path';

import { adapter } from '../google-calendar/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Google Calendar adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  describe('executeVerb create_event', () => {
    it('POSTs to /calendar/v3/calendars/primary/events with Bearer token and Microsoft-Graph-style start/end with timeZone defaulted from accountMeta', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'evt-1',
            htmlLink: 'https://calendar.google.com/event?eid=evt-1',
          }),
          { status: 200 }
        )
      );

      const result = await adapter.executeVerb(
        'create_event',
        {
          summary: 'Meeting',
          description: 'Sync meeting',
          start: '2026-05-01T14:00:00Z',
          end: '2026-05-01T15:00:00Z',
          location: 'Room 1',
        },
        'mock-tok',
        { timezone: 'America/New_York' }
      );

      expect(result).toEqual({
        success: true,
        result: { eventId: 'evt-1', eventUrl: 'https://calendar.google.com/event?eid=evt-1' },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            'Content-Type': 'application/json',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.summary).toBe('Meeting');
      expect(body.description).toBe('Sync meeting');
      expect(body.location).toBe('Room 1');
      expect(body.start).toEqual({ dateTime: '2026-05-01T14:00:00Z', timeZone: 'America/New_York' });
      expect(body.end).toEqual({ dateTime: '2026-05-01T15:00:00Z', timeZone: 'America/New_York' });
    });

    it('defaults timeZone to UTC when accountMeta.timezone is missing', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'evt-2', htmlLink: 'https://calendar.google.com/event?eid=evt-2' }),
          { status: 200 }
        )
      );

      await adapter.executeVerb(
        'create_event',
        { summary: 'Quick sync', start: '2026-05-01T14:00:00Z', end: '2026-05-01T14:30:00Z' },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.start.timeZone).toBe('UTC');
      expect(body.end.timeZone).toBe('UTC');
    });

    it('uses the browser time zone for a bare local time when accountMeta.timezone is missing', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'evt-local', htmlLink: 'https://calendar.google.com/event?eid=evt-local' }), { status: 200 })
      );

      await adapter.executeVerb(
        'create_event',
        { summary: 'Local', start: '2026-05-01T14:00', end: '2026-05-01T14:30' },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.start.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
      // Google rejects a dateTime without seconds with 400 Bad Request.
      expect(body.start.dateTime).toBe('2026-05-01T14:00:00');
      expect(body.end.dateTime).toBe('2026-05-01T14:30:00');
    });

    it('omits undefined fields from the request body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'evt-3', htmlLink: 'https://calendar.google.com/event?eid=evt-3' }),
          { status: 200 }
        )
      );

      await adapter.executeVerb(
        'create_event',
        { summary: 'Title only', start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' },
        'mock-tok',
        { timezone: 'UTC' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(JSON.stringify(body)).not.toContain('undefined');
      expect(body.description).toBeUndefined();
      expect(body.location).toBeUndefined();
    });
  });

  describe('executeVerb schedule_tab_as_event', () => {
    it('derives end_iso = when_iso + duration_minutes and forwards through create_event', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'evt-tab', htmlLink: 'https://calendar.google.com/event?eid=evt-tab' }),
          { status: 200 }
        )
      );

      const result = await adapter.executeVerb(
        'schedule_tab_as_event',
        {
          tabTitle: 'Article',
          tabUrl: 'https://example.com/article',
          when_iso: '2026-05-01T14:00:00Z',
          duration_minutes: 30,
        },
        'mock-tok',
        { timezone: 'America/New_York' }
      );

      expect(result).toEqual({
        success: true,
        result: { eventId: 'evt-tab', eventUrl: 'https://calendar.google.com/event?eid=evt-tab' },
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.summary).toBe('Article');
      expect(body.description).toBe('https://example.com/article');
      expect(body.start.dateTime).toBe('2026-05-01T14:00:00Z');
      expect(body.end.dateTime).toBe('2026-05-01T14:30:00.000Z');
      expect(body.start.timeZone).toBe('America/New_York');
    });

    it('defaults duration_minutes to 30 when omitted', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'evt-d', htmlLink: 'https://calendar.google.com/event?eid=evt-d' }),
          { status: 200 }
        )
      );

      await adapter.executeVerb(
        'schedule_tab_as_event',
        {
          tabTitle: 'Article',
          tabUrl: 'https://example.com/article',
          when_iso: '2026-05-01T14:00:00Z',
        },
        'mock-tok',
        { timezone: 'UTC' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.end.dateTime).toBe('2026-05-01T14:30:00.000Z');
    });

    it('appends tabNotes to the description when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'evt-n', htmlLink: 'https://calendar.google.com/event?eid=evt-n' }),
          { status: 200 }
        )
      );

      await adapter.executeVerb(
        'schedule_tab_as_event',
        {
          tabTitle: 'Article',
          tabUrl: 'https://example.com/article',
          tabNotes: 'Read before 5pm',
          when_iso: '2026-05-01T14:00:00Z',
          duration_minutes: 60,
        },
        'mock-tok',
        { timezone: 'UTC' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.description).toBe('https://example.com/article\n\nRead before 5pm');
    });
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'create_event',
          { summary: 'M', start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' },
          'mock-tok',
          { timezone: 'UTC' }
        )
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws the provider Response on 429 so dispatch can read Retry-After', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
      await expect(
        adapter.executeVerb(
          'create_event',
          { summary: 'M', start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' },
          'mock-tok',
          { timezone: 'UTC' }
        )
      ).rejects.toMatchObject({ status: 429 });
    });

    it('returns unknown_verb for unrecognized verbs', async () => {
      const result = await adapter.executeVerb(
        'mystery_verb',
        {},
        'mock-tok',
        { timezone: 'UTC' }
      );
      expect(result).toEqual({ success: false, error: 'unknown_verb' });
    });
  });

  describe('XC-01 contract', () => {
    it('does not write storage directly in the adapter file', () => {
      const adapterPath = path.resolve(__dirname, '../google-calendar/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
