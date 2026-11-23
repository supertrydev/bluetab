import { Storage } from '@/utils/storage';
import { TagManager } from '@/utils/tags';
import type { TabGroup, Tag } from '@/types/models';
import { t } from '@/i18n';
import { BLUETAB_FAVICON, GITHUB_FAVICON } from './welcome-icons';

export const MANAGER_WELCOME_KEY = 'managerWelcomePending';

export async function markManagerWelcomePending(reason: string): Promise<void> {
  if (reason === 'install') await Storage.set(MANAGER_WELCOME_KEY, true);
}

async function consumeWelcome(): Promise<'sample' | 'existing' | null> {
  if (!await Storage.get<boolean>(MANAGER_WELCOME_KEY)) return null;
  let added = false;
  if (!(await Storage.get<TabGroup[]>('groups'))?.length) {
    const tags = await Storage.get<Tag[]>('tags') ?? [];
    const name = t('managerWelcome.exampleTag');
    let tag = tags.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!tag) {
      tag = TagManager.createTag(name, '#3b82f6');
      await Storage.set('tags', [...tags, tag]);
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const group: TabGroup = {
      id, name: t('managerWelcome.groupName'), color: '#3b82f6', tags: [tag.id],
      created: now, modified: now,
      tabs: [
        ['bluetab', 'https://bluetab.in', BLUETAB_FAVICON],
        ['releases', 'https://github.com/supertrydev/bluetab/releases', GITHUB_FAVICON],
        ['connect', 'https://supertry.net/docs/bluetab-mcp', BLUETAB_FAVICON],
        ['feedback', 'https://github.com/supertrydev/bluetab/issues/new/choose', GITHUB_FAVICON],
      ].map(([key, url, favicon]) => ({
        id: crypto.randomUUID(), groupId: id, title: t(`managerWelcome.tabs.${key}`),
        url, favicon, timestamp: now,
      })),
    };
    // Re-read after async tag creation: never replace groups created during setup.
    const groups = await Storage.get<TabGroup[]>('groups') ?? [];
    if (groups.length === 0) {
      await Storage.set('groups', [...groups, group]);
      added = true;
    }
  }
  await Storage.set(MANAGER_WELCOME_KEY, false);
  return added ? 'sample' : 'existing';
}

let queue: Promise<unknown> = Promise.resolve();
export function consumeManagerWelcome(): Promise<'sample' | 'existing' | null> {
  // Web Locks serialize manager windows; the queue also covers repeated mounts.
  const run = async () => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('bluetab-manager-welcome', consumeWelcome)
    : consumeWelcome();
  const result = queue.then(run, run);
  queue = result;
  return result;
}
