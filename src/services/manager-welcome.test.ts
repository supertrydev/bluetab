import { Storage } from '@/utils/storage';
import { initI18n } from '@/i18n';
import { consumeManagerWelcome, markManagerWelcomePending } from './manager-welcome';
import type { TabGroup, Tag } from '@/types/models';

jest.mock('@/utils/storage', () => ({ Storage: { get: jest.fn(), set: jest.fn() } }));
let data: Record<string, unknown>;
beforeEach(async () => {
  jest.clearAllMocks();
  data = {};
  (Storage.get as jest.Mock).mockImplementation(async key => data[key] ?? null);
  (Storage.set as jest.Mock).mockImplementation(async (key, value) => { data[key] = value; });
  await initI18n({ language: 'en' });
});

it('consumes a fresh install exactly once even when managers open together', async () => {
  await markManagerWelcomePending('install');
  expect(await Promise.all([consumeManagerWelcome(), consumeManagerWelcome()])).toEqual(['sample', null]);
  const groups = data.groups as TabGroup[];
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ name: 'Getting started with Bluetab', color: '#3b82f6' });
  expect(groups[0].tabs.map(tab => tab.url)).toEqual([
    'https://bluetab.in', 'https://github.com/supertrydev/bluetab/releases',
    'https://supertry.net/docs/bluetab-mcp', 'https://github.com/supertrydev/bluetab/issues/new/choose',
  ]);
  for (const tab of groups[0].tabs) {
    expect(tab.favicon).toMatch(/^data:image\//);
    expect(tab.groupId).toBe(groups[0].id);
  }
  expect(data.managerWelcomePending).toBe(false);
  expect(await consumeManagerWelcome()).toBeNull();
});

it('never flags updates or adds sample data on updates', async () => {
  await markManagerWelcomePending('update');
  expect(await consumeManagerWelcome()).toBeNull();
  expect(Storage.set).not.toHaveBeenCalled();
});

it('preserves existing groups and consumes the welcome without a sample', async () => {
  data.groups = [{ id: 'existing', tabs: [] }];
  const original = data.groups;
  await markManagerWelcomePending('install');
  expect(await consumeManagerWelcome()).toBe('existing');
  expect(data.groups).toBe(original);
  expect(data.tags).toBeUndefined();
  expect(await consumeManagerWelcome()).toBeNull();
});

it('reuses a tag with the localized example name', async () => {
  await initI18n({ language: 'tr' });
  data.tags = [{ id: 'example', name: 'Örnek', color: '#123', created: 0 }];
  await markManagerWelcomePending('install');
  await consumeManagerWelcome();
  expect(data.tags as Tag[]).toHaveLength(1);
  expect((data.groups as TabGroup[])[0]).toMatchObject({ name: 'Bluetab’e başlarken', tags: ['example'] });
});

it('rechecks groups after tag creation so a newly saved group is preserved', async () => {
  const original = [{ id: 'newly-saved', tabs: [] }];
  (Storage.set as jest.Mock).mockImplementation(async (key, value) => {
    data[key] = value;
    if (key === 'tags') data.groups = original;
  });
  await markManagerWelcomePending('install');
  expect(await consumeManagerWelcome()).toBe('existing');
  expect(data.groups).toBe(original);
});
