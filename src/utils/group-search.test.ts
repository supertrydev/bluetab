import { getSearchVisibleTabs, groupMatchesSearch } from './group-search';
import type { TabGroup, Tag } from '@/types/models';

const tab = (id: string, title: string) => ({ id, title, url: `https://${id}.example`, timestamp: 1, groupId: 'g' }) as TabGroup['tabs'][number];
const group = { id: 'g', name: 'Trip', created: 1, modified: 1, notes: 'Book the FERRY before Friday', tags: ['t'], tabs: [tab('a', 'Maps'), tab('b', 'Hotels')] } as TabGroup;
const tags = [{ id: 't', name: 'Summer', color: '#fff', created: 1 }] as Tag[];

describe('saved group search', () => {
  it.each(['trip', 'ferry', 'before friday', 'hotels', 'a.example', 'summer', ''])('finds the group by "%s"', (query) => {
    expect(groupMatchesSearch(group, tags, query)).toBe(true);
  });

  it('does not find a group by something it does not hold', () => {
    expect(groupMatchesSearch(group, tags, 'winter')).toBe(false);
    expect(groupMatchesSearch({ ...group, notes: undefined }, tags, 'ferry')).toBe(false);
  });

  it('lists matching tabs, or all of them when the note or a tag matched', () => {
    expect(getSearchVisibleTabs(group, 'hotels').map((item) => item.id)).toEqual(['b']);
    expect(getSearchVisibleTabs(group, 'ferry')).toHaveLength(2);
    expect(getSearchVisibleTabs(group, 'summer')).toHaveLength(2);
  });
});
