import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import { Storage } from '../../../utils/storage';
import {
  executeProviderRequest,
  isCloudConnectionCredential,
} from '../cloud-operation-client';

const READWISE_HIGHLIGHTS_URL = 'https://readwise.io/api/v2/highlights/';
const READWISE_READER_URL = 'https://readwise.io/api/v3/save/';
const READWISE_AUTH_URL = 'https://readwise.io/api/v2/auth/';

const BRAIN_DUMP_FALLBACK_URL = 'https://bluetab.app/brain-dump';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Readwise uses the `Token` authorization scheme — NOT Bearer. The pasted
 * value is a long-lived API token from https://readwise.io/access_token.
 */
function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Token ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

interface HighlightInput {
  title: string;
  source_url: string;
  text: string;
}

async function postHighlight(
  highlight: HighlightInput,
  accessToken: string
): Promise<{ success: boolean; result?: { savedCount: number }; error?: string }> {
  const body = {
    highlights: [
      {
        title: highlight.title,
        source_url: highlight.source_url,
        text: highlight.text,
        source_type: 'web',
        category: 'articles',
      },
    ],
  };
  const response = await executeProviderRequest(accessToken, 'readwise.highlight.create', { body }, () => fetch(READWISE_HIGHLIGHTS_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  }));

  if (!response.ok) {
    throw response;
  }

  const data = (await response.json().catch(() => [])) as unknown;
  const count = Array.isArray(data) ? data.length : 1;
  return { success: true, result: { savedCount: count } };
}

async function saveArticle(
  args: Record<string, unknown>,
  accessToken: string
): Promise<ReturnType<typeof postHighlight>> {
  const title = asString(args.title);
  const sourceUrl = asString(args.source_url);
  const text = asString(args.text);
  if (!title) {
    throw new Error('missing_title');
  }
  if (!sourceUrl) {
    throw new Error('missing_source_url');
  }
  if (!text) {
    throw new Error('missing_text');
  }
  return postHighlight({ title, source_url: sourceUrl, text }, accessToken);
}

async function saveToReader(
  url: string,
  title: string | undefined,
  accessToken: string
): Promise<{ success: boolean; result?: { id?: string }; error?: string }> {
  const body: Record<string, string> = { url };
  if (title) body.title = title;

  const response = await executeProviderRequest(accessToken, 'readwise.reader.save', { body }, () => fetch(READWISE_READER_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  }));

  if (!response.ok) {
    throw response;
  }

  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { success: true, result: { id: data.id } };
}

async function sendGroupToReadwise(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ success: boolean; result?: { created: number; errors: number }; error?: string }> {
  const groupId = asString(args.groupId);
  if (!groupId) {
    throw new Error('missing_group_id');
  }

  // Look up active groups first (same pattern as Slack adapter), then fall
  // back to remembered (GroupMemoryStorageService) so both active and
  // remembered groups work.
  const activeGroups = await Storage.get<Array<{ id: string; tabs: Array<{ url: string; title?: string }> }>>('groups');
  const activeGroup = activeGroups?.find(g => g.id === groupId);

  const memory = await GroupMemoryStorageService.getMemory();
  const rememberedGroup = memory.groups[groupId];

  const tabs: Array<{ url: string; title?: string }> = activeGroup
    ? activeGroup.tabs
    : rememberedGroup
      ? rememberedGroup.tabs
      : null!;

  if (!tabs) {
    throw new Error('group_not_found');
  }

  const settled = await Promise.allSettled(
    tabs.map((tab) =>
      saveToReader(tab.url, tab.title?.trim() || undefined, accessToken)
    )
  );

  const retryable = settled.find(
    (result) =>
      result.status === 'rejected' &&
      result.reason instanceof Response &&
      [401, 429].includes(result.reason.status)
  );
  if (retryable?.status === 'rejected') {
    throw retryable.reason;
  }

  return {
    success: true,
    result: {
      created: settled.filter((r) => r.status === 'fulfilled').length,
      errors: settled.filter((r) => r.status === 'rejected').length,
    },
  };
}

async function pushBrainDumpToReadwise(
  args: Record<string, unknown>,
  accessToken: string
): Promise<ReturnType<typeof postHighlight>> {
  const entryId = asString(args.entryId);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = asString(args.text) || entry.text;
  const sourceUrl = entry.tabContext?.url || BRAIN_DUMP_FALLBACK_URL;
  return postHighlight(
    { title: 'Brain dump', source_url: sourceUrl, text },
    accessToken
  );
}

export const adapter: IntegrationAdapter = {
  async executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    _accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      switch (verb) {
        case 'save_article':
          return await saveArticle(args, accessToken);
        case 'send_group_to_readwise':
          return await sendGroupToReadwise(args, accessToken);
        case 'push_brain_dump_to_readwise':
          return await pushBrainDumpToReadwise(args, accessToken);
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

  async validateToken(accessToken: string): Promise<boolean> {
    const response = await executeProviderRequest(accessToken, 'readwise.auth.check', {}, () => fetch(READWISE_AUTH_URL, {
      method: 'GET',
      headers: authHeaders(accessToken),
    }));
    return isCloudConnectionCredential(accessToken) ? response.ok : response.status === 204;
  },
};
