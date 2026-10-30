import {
  buildIntegrationContextMenuDispatch,
  type BuildIntegrationContextMenuDispatchInput,
} from '../integration-context-menu';

function buildInput(
  overrides: Partial<BuildIntegrationContextMenuDispatchInput>
): BuildIntegrationContextMenuDispatchInput {
  return {
    integrationId: 'discord',
    kind: 'page',
    pageTitle: 'Example Page',
    pageUrl: 'https://example.com/page',
    ...overrides,
  };
}

describe('buildIntegrationContextMenuDispatch', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-30T09:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('maps selected text for Discord to share_to_channel with source context', () => {
    const dispatch = buildIntegrationContextMenuDispatch(buildInput({
      integrationId: 'discord',
      kind: 'selection',
      selectionText: 'Subscription details',
    }));

    expect(dispatch).toEqual({
      verb: 'share_to_channel',
      args: {
        content: 'Subscription details\n\nSource: https://example.com/page',
      },
    });
  });

  it('maps a page send for Discord to share_to_channel instead of group send', () => {
    const dispatch = buildIntegrationContextMenuDispatch(buildInput({
      integrationId: 'discord',
      kind: 'page',
    }));

    expect(dispatch).toEqual({
      verb: 'share_to_channel',
      args: {
        content: 'Example Page\n\nhttps://example.com/page',
      },
    });
  });

  it('maps page sends for Google Calendar to schedule_tab_as_event', () => {
    const dispatch = buildIntegrationContextMenuDispatch(buildInput({
      integrationId: 'google-calendar',
      kind: 'page',
    }));

    expect(dispatch).toEqual({
      verb: 'schedule_tab_as_event',
      args: {
        tabTitle: 'Example Page',
        tabUrl: 'https://example.com/page',
        when_iso: '2026-06-30T10:00:00.000Z',
        duration_minutes: 30,
      },
    });
  });

  it('maps Notion quick send to append_to_database using the configured default target', () => {
    const dispatch = buildIntegrationContextMenuDispatch(buildInput({
      integrationId: 'notion',
      kind: 'selection',
      selectionText: 'Plan the launch email',
      defaultSyncTarget: 'db-123',
    }));

    expect(dispatch).toEqual({
      verb: 'append_to_database',
      args: {
        database_id: 'db-123',
        properties: {
          Name: { title: [{ text: { content: 'Plan the launch email' } }] },
          URL: { url: 'https://example.com/page' },
        },
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                { type: 'text', text: { content: 'Plan the launch email\n\nSource: https://example.com/page' } },
              ],
            },
          },
        ],
      },
    });
  });

  it('maps Readwise link sends to save_article with the link as source', () => {
    const dispatch = buildIntegrationContextMenuDispatch(buildInput({
      integrationId: 'readwise',
      kind: 'link',
      linkUrl: 'https://example.com/article',
      pageTitle: 'Ignored in link mode',
    }));

    expect(dispatch).toEqual({
      verb: 'save_article',
      args: {
        title: 'https://example.com/article',
        source_url: 'https://example.com/article',
        text: 'https://example.com/article',
      },
    });
  });
});
