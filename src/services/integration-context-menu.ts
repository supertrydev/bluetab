import type { IntegrationId } from './integrations/registry';

export type IntegrationContextMenuKind = 'selection' | 'page' | 'link';

export interface BuildIntegrationContextMenuDispatchInput {
  integrationId: IntegrationId;
  kind: IntegrationContextMenuKind;
  selectionText?: string | null;
  pageTitle?: string | null;
  pageUrl?: string | null;
  linkUrl?: string | null;
  defaultSyncTarget?: string | null;
}

export interface IntegrationContextMenuDispatch {
  verb: string;
  args: Record<string, unknown>;
}

const DEFAULT_EVENT_DELAY_MS = 60 * 60_000;
const DEFAULT_EVENT_DURATION_MINUTES = 30;
const READWISE_FALLBACK_URL = 'https://bluetab.app';

function asTrimmed(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function compactText(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

function buildSourceUrl(input: BuildIntegrationContextMenuDispatchInput): string | undefined {
  if (input.kind === 'link') {
    return asTrimmed(input.linkUrl);
  }
  return asTrimmed(input.pageUrl);
}

function buildSourceTitle(
  input: BuildIntegrationContextMenuDispatchInput,
  sourceUrl?: string
): string {
  if (input.kind === 'page') {
    return asTrimmed(input.pageTitle) || sourceUrl || 'Untitled page';
  }
  return sourceUrl || asTrimmed(input.pageTitle) || 'Untitled item';
}

function buildSelectionText(input: BuildIntegrationContextMenuDispatchInput): string | undefined {
  return input.kind === 'selection' ? asTrimmed(input.selectionText) : undefined;
}

function buildPrimaryText(
  input: BuildIntegrationContextMenuDispatchInput,
  sourceTitle: string,
  max: number
): string {
  const selectionText = buildSelectionText(input);
  return compactText(selectionText || sourceTitle, max);
}

function buildSourceSummary(title: string, url?: string): string {
  if (!url) {
    return title;
  }
  if (!title || title === url) {
    return url;
  }
  return `${title}\n\n${url}`;
}

function buildDetails(
  input: BuildIntegrationContextMenuDispatchInput,
  sourceTitle: string,
  sourceUrl?: string
): string {
  const selectionText = buildSelectionText(input);
  if (selectionText) {
    return sourceUrl ? `${selectionText}\n\nSource: ${sourceUrl}` : selectionText;
  }
  return buildSourceSummary(sourceTitle, sourceUrl);
}

function buildNotionProperties(title: string, sourceUrl?: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: title } }] },
  };
  if (sourceUrl) {
    properties.URL = { url: sourceUrl };
  }
  return properties;
}

function buildNotionChildren(details: string): Array<Record<string, unknown>> | undefined {
  if (!details) {
    return undefined;
  }
  return [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: details } }],
      },
    },
  ];
}

function buildEventRange(): { startIso: string; endIso: string } {
  const startMs = Date.now() + DEFAULT_EVENT_DELAY_MS;
  const endMs = startMs + DEFAULT_EVENT_DURATION_MINUTES * 60_000;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

export function buildIntegrationContextMenuDispatch(
  input: BuildIntegrationContextMenuDispatchInput
): IntegrationContextMenuDispatch | null {
  const sourceUrl = buildSourceUrl(input);
  const sourceTitle = buildSourceTitle(input, sourceUrl);
  const details = buildDetails(input, sourceTitle, sourceUrl);

  switch (input.integrationId) {
    case 'discord':
      return {
        verb: 'share_to_channel',
        args: { content: details },
      };
    case 'slack':
      return {
        verb: 'share_to_channel',
        args: { text: details },
      };
    case 'linear':
      return {
        verb: 'create_issue',
        args: {
          title: buildPrimaryText(input, sourceTitle, 100),
          description: details,
        },
      };
    case 'todoist':
      return {
        verb: 'create_task',
        args: {
          content: buildPrimaryText(input, sourceTitle, 500),
          description: details,
        },
      };
    case 'notion': {
      const title = buildPrimaryText(input, sourceTitle, 100);
      return {
        verb: 'append_to_database',
        args: {
          ...(input.defaultSyncTarget ? { database_id: input.defaultSyncTarget } : {}),
          properties: buildNotionProperties(title, sourceUrl),
          ...(buildNotionChildren(details) ? { children: buildNotionChildren(details) } : {}),
        },
      };
    }
    case 'google-calendar': {
      if (input.kind !== 'selection') {
        return {
          verb: 'schedule_tab_as_event',
          args: {
            tabTitle: buildPrimaryText(input, sourceTitle, 100),
            tabUrl: sourceUrl || sourceTitle,
            when_iso: buildEventRange().startIso,
            duration_minutes: DEFAULT_EVENT_DURATION_MINUTES,
          },
        };
      }
      const { startIso, endIso } = buildEventRange();
      return {
        verb: 'create_event',
        args: {
          summary: buildPrimaryText(input, sourceTitle, 100),
          description: details,
          start: startIso,
          end: endIso,
        },
      };
    }
    case 'outlook-calendar': {
      if (input.kind !== 'selection') {
        return {
          verb: 'schedule_tab_as_event',
          args: {
            tabTitle: buildPrimaryText(input, sourceTitle, 100),
            tabUrl: sourceUrl || sourceTitle,
            when_iso: buildEventRange().startIso,
            duration_minutes: DEFAULT_EVENT_DURATION_MINUTES,
          },
        };
      }
      const { startIso, endIso } = buildEventRange();
      return {
        verb: 'create_event',
        args: {
          subject: buildPrimaryText(input, sourceTitle, 100),
          body: details,
          start: startIso,
          end: endIso,
        },
      };
    }
    case 'readwise':
      return {
        verb: 'save_article',
        args: {
          title: buildPrimaryText(input, sourceTitle, 100),
          source_url: sourceUrl || READWISE_FALLBACK_URL,
          text: buildSelectionText(input) || buildSourceSummary(sourceTitle, sourceUrl),
        },
      };
    case 'jira':
      return {
        verb: 'create_issue',
        args: {
          summary: buildPrimaryText(input, sourceTitle, 100),
          description: details,
        },
      };
    case 'trello':
      return {
        verb: 'create_card',
        args: {
          name: buildPrimaryText(input, sourceTitle, 200),
          desc: details,
        },
      };
    case 'asana':
      return {
        verb: 'create_task',
        args: {
          name: buildPrimaryText(input, sourceTitle, 100),
          notes: details,
          ...(input.defaultSyncTarget ? { project: input.defaultSyncTarget } : {}),
        },
      };
    case 'gitlab':
      return {
        verb: 'create_issue',
        args: {
          title: buildPrimaryText(input, sourceTitle, 100),
          description: details,
        },
      };
    default:
      return null;
  }
}
