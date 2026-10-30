import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { GroupMemoryStorageService } from '../../../utils/group-memory-storage';
import { fetchTrelloApiKey } from '../../integration-oauth-service';
import { executeProviderRequest } from '../cloud-operation-client';

const TRELLO_CARDS_URL = 'https://api.trello.com/1/cards';
const TRELLO_BOARDS_URL = 'https://api.trello.com/1/members/me/boards';

type TrelloCardResponse = {
  id?: string;
  url?: string;
};

export interface TrelloList {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
}

type TrelloBoardResponse = {
  id?: string;
  name?: string;
  closed?: boolean;
};

type TrelloListResponse = {
  id?: string;
  name?: string;
  closed?: boolean;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

async function buildCardsUrl(token: string): Promise<string> {
  const apiKey = await fetchTrelloApiKey();
  const params = new URLSearchParams({ key: apiKey, token });
  return `${TRELLO_CARDS_URL}?${params.toString()}`;
}

export async function fetchLists(token: string): Promise<TrelloList[]> {
  const boardsResponse = await executeProviderRequest(token, 'trello.boards.list', {}, async () => {
    const apiKey = await fetchTrelloApiKey();
    const boardParams = new URLSearchParams({
      key: apiKey,
      token,
      fields: 'id,name,closed',
    });
    return fetch(`${TRELLO_BOARDS_URL}?${boardParams.toString()}`);
  });
  if (!boardsResponse.ok) {
    throw boardsResponse;
  }

  const boards = (await boardsResponse.json()) as TrelloBoardResponse[];
  const openBoards = boards.filter((board) => board.id && board.closed !== true);
  const listGroups = await Promise.all(
    openBoards.map(async (board) => {
      const response = await executeProviderRequest(token, 'trello.lists.list', { boardId: board.id! }, async () => {
        const apiKey = await fetchTrelloApiKey();
        const listParams = new URLSearchParams({
          key: apiKey,
          token,
          fields: 'id,name,closed',
        });
        return fetch(`https://api.trello.com/1/boards/${board.id}/lists?${listParams.toString()}`);
      });
      if (!response.ok) {
        throw response;
      }
      const lists = (await response.json()) as TrelloListResponse[];
      return lists
        .filter((list) => list.id && list.name && list.closed !== true)
        .map((list) => ({
          id: list.id!,
          name: list.name!,
          boardId: board.id!,
          boardName: board.name || 'Untitled board',
        }));
    })
  );

  return listGroups.flat().sort((a, b) => `${a.boardName} ${a.name}`.localeCompare(`${b.boardName} ${b.name}`));
}

interface CardInput {
  idList: string;
  name: string;
  desc?: string;
  idLabels?: string[];
  due?: string;
}

async function postCard(
  input: CardInput,
  token: string
): Promise<{ success: boolean; result?: { cardId?: string; cardUrl?: string }; error?: string }> {
  const body: Record<string, unknown> = {
    idList: input.idList,
    name: input.name,
  };
  if (input.desc !== undefined) body.desc = input.desc;
  if (input.idLabels !== undefined) body.idLabels = input.idLabels;
  if (input.due !== undefined) body.due = input.due;

  const response = await executeProviderRequest(token, 'trello.card.create', { body }, async () => fetch(await buildCardsUrl(token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  if (!response.ok) {
    throw response;
  }
  const data = (await response.json()) as TrelloCardResponse;
  return { success: true, result: { cardId: data.id, cardUrl: data.url } };
}

async function createCard(
  args: Record<string, unknown>,
  token: string
): Promise<ReturnType<typeof postCard>> {
  const idList = asString(args.idList);
  const name = asString(args.name);
  if (!idList) {
    throw new Error('missing_id_list');
  }
  if (!name) {
    throw new Error('missing_name');
  }
  return postCard(
    {
      idList,
      name,
      desc: asString(args.desc),
      idLabels: asStringArray(args.idLabels),
      due: asString(args.due),
    },
    token
  );
}

async function sendGroupToTrello(
  args: Record<string, unknown>,
  token: string
): Promise<{ success: boolean; result?: { created: number; errors: number }; error?: string }> {
  const groupId = asString(args.groupId);
  const idList = asString(args.idList);
  if (!groupId) {
    throw new Error('missing_group_id');
  }
  if (!idList) {
    throw new Error('missing_id_list');
  }

  const memory = await GroupMemoryStorageService.getMemory();
  const group = memory.groups[groupId];
  if (!group) {
    throw new Error('group_not_found');
  }

  const settled = await Promise.allSettled(
    group.tabs.map((tab) => {
      const tabTitle = tab.title?.trim() || tab.url || 'Untitled tab';
      const notes = (tab as { notes?: string }).notes;
      const desc = notes ? `${tab.url}\n\n${notes}` : tab.url;
      return postCard({ idList, name: tabTitle, desc }, token);
    })
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

async function pushBrainDumpToTrello(
  args: Record<string, unknown>,
  token: string
): Promise<ReturnType<typeof postCard>> {
  const entryId = asString(args.entryId);
  const idList = asString(args.idList);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }
  if (!idList) {
    throw new Error('missing_id_list');
  }

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = asString(args.text) || entry.text;
  const tabUrl = entry.tabContext?.url;
  const desc = tabUrl ? `${text}\n\n${tabUrl}` : text;
  const name = text.slice(0, 200) || 'Brain dump';
  return postCard({ idList, name, desc }, token);
}

export const adapter: IntegrationAdapter = {
  async executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      if (!args.idList && accountMeta.default_target) {
        args = { ...args, idList: accountMeta.default_target };
      }
      switch (verb) {
        case 'create_card':
          return await createCard(args, accessToken);
        case 'send_group_to_trello':
          return await sendGroupToTrello(args, accessToken);
        case 'push_brain_dump_to_trello':
          return await pushBrainDumpToTrello(args, accessToken);
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
