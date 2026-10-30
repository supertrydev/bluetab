import * as fs from 'fs';
import * as path from 'path';

import { adapter } from '../outlook-calendar/adapter';

const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Outlook Calendar adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  describe('executeVerb create_event', () => {
    it('POSTs to https://graph.microsoft.com/v1.0/me/events with Microsoft Graph payload shape', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'evt-1',
            webLink: 'https://outlook.office.com/calendar/item/evt-1',
          }),
          { status: 201 }
        )
      );

      const result = await adapter.executeVerb(
        'create_event',
        {
          subject: 'Meeting',
          body: 'Sync meeting',
          start: '2026-05-01T14:00:00Z',
          end: '2026-05-01T15:00:00Z',
          location: 'Room 1',
        },
        'mock-tok',
        { timezone: 'America/New_York' }
      );

      expect(result).toEqual({
        success: true,
        result: {
          eventId: 'evt-1',
          eventUrl: 'https://outlook.office.com/calendar/item/evt-1',
        },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/me/events',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-tok',
            'Content-Type': 'application/json',
          }),
        })
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.subject).toBe('Meeting');
      expect(body.body).toEqual({ contentType: 'HTML', content: 'Sync meeting' });
      expect(body.start).toEqual({
        dateTime: '2026-05-01T14:00:00Z',
        timeZone: 'America/New_York',
      });
      expect(body.end).toEqual({
        dateTime: '2026-05-01T15:00:00Z',
        timeZone: 'America/New_York',
      });
      expect(body.location).toEqual({ displayName: 'Room 1' });
    });

    it('falls back to description when body is not provided, and to empty string when both are missing', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'evt-d', webLink: 'https://outlook.office.com/calendar/item/evt-d' }), {
          status: 201,
        })
      );

      await adapter.executeVerb(
        'create_event',
        { subject: 'Sync', start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' },
        'mock-tok',
        { timezone: 'UTC' }
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.body).toEqual({ contentType: 'HTML', content: '' });
      expect(body.location).toBeUndefined();
    });

    it('always includes a timeZone field even when accountMeta.timezone is missing (Microsoft Graph requirement)', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'evt-tz', webLink: 'https://outlook.office.com/calendar/item/evt-tz' }), {
          status: 201,
        })
      );

      await adapter.executeVerb(
        'create_event',
        { subject: 'Sync', start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.start.timeZone).toBe('UTC');
      expect(body.end.timeZone).toBe('UTC');
    });

    it('uses the browser time zone for a bare local time when accountMeta.timezone is missing', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'evt-local', webLink: 'https://outlook.office.com/calendar/item/evt-local' }), {
          status: 201,
        })
      );

      await adapter.executeVerb(
        'create_event',
        { subject: 'Local', start: '2026-05-01T14:00', end: '2026-05-01T15:00' },
        'mock-tok',
        {}
      );

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.start.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
      expect(body.start.dateTime).toBe('2026-05-01T14:00:00');
      expect(body.end.dateTime).toBe('2026-05-01T15:00:00');
    });
  });

  describe('executeVerb schedule_tab_as_event', () => {
    it('derives end_iso = when_iso + duration_minutes and forwards through create_event with Microsoft Graph payload', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'evt-tab', webLink: 'https://outlook.office.com/calendar/item/evt-tab' }),
          { status: 201 }
        )
      );

      const result = await adapter.executeVerb(
        'schedule_tab_as_event',
        {
          tabTitle: 'Article',
          tabUrl: 'https://example.com/article',
          when_iso: '2026-05-01T14:00:00Z',
          duration_minutes: 45,
        },
        'mock-tok',
        { timezone: 'Europe/London' }
      );

      expect(result).toEqual({
        success: true,
        result: {
          eventId: 'evt-tab',
          eventUrl: 'https://outlook.office.com/calendar/item/evt-tab',
        },
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.subject).toBe('Article');
      expect(body.body).toEqual({ contentType: 'HTML', content: 'https://example.com/article' });
      expect(body.start.dateTime).toBe('2026-05-01T14:00:00Z');
      expect(body.end.dateTime).toBe('2026-05-01T14:45:00.000Z');
      expect(body.start.timeZone).toBe('Europe/London');
    });

    it('defaults duration_minutes to 30 when omitted', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'evt-d', webLink: 'https://outlook.office.com/calendar/item/evt-d' }),
          { status: 201 }
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
  });

  describe('error handling', () => {
    it('throws the provider Response on 401 so dispatch can flag reauth', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(
        adapter.executeVerb(
          'create_event',
          { subject: 'M', start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' },
          'mock-tok',
          { timezone: 'UTC' }
        )
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws the provider Response on 429 so dispatch can read Retry-After', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '5' } }));
      await expect(
        adapter.executeVerb(
          'create_event',
          { subject: 'M', start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' },
          'mock-tok',
          { timezone: 'UTC' }
        )
      ).rejects.toMatchObject({ status: 429 });
    });

    it('returns unknown_verb for unrecognized verbs', async () => {
      const result = await adapter.executeVerb('mystery_verb', {}, 'mock-tok', { timezone: 'UTC' });
      expect(result).toEqual({ success: false, error: 'unknown_verb' });
    });
  });

  describe('XC-01 contract', () => {
    it('does not write storage directly in the adapter file', () => {
      const adapterPath = path.resolve(__dirname, '../outlook-calendar/adapter.ts');
      const source = fs.readFileSync(adapterPath, 'utf-8');
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      expect(stripped).not.toMatch(/chrome\.storage\.local\.set\s*\(/);
      expect(stripped).not.toMatch(/Storage\.set\s*\(/);
    });
  });
});
