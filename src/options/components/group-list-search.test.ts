import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as ts from 'typescript';
import * as searchText from '@/utils/search-text';
import { countVisibleTabRowsForGroupList } from './group-list-performance';
import type { TabGroup } from '@/types/models';

// Execute the actual manager memo against saved records without mounting drag/drop UI.
const source = readFileSync(resolve(__dirname, 'GroupListView.tsx'), 'utf8');
const memo = source.slice(source.indexOf('const filteredAndSortedGroups = useMemo('), source.indexOf('const visibleTabRowsForPerformance'));
const evaluate = new Function('groups', 'tags', 'search', 'matchesSearch', 'normalizeForSearch', `
  const activeProjectId = null, projects = [], currentSortOrder = 'newest';
  const sortGroupsWithPinning = (groups) => groups;
  const useMemo = (fn) => fn();
  ${ts.transpileModule(memo, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText}
  return filteredAndSortedGroups;
`);
const groups = [
  { id: 'name', name: '\u0130stanbul', tabs: [{ title: 'Other', url: 'https://one.test' }] },
  { id: 'title', name: 'Reading', tabs: [{ title: 'Café', url: 'https://two.test' }, { title: 'Other', url: 'https://other.test' }] },
  { id: 'tag', name: 'Tagged', tags: ['ar'], tabs: [{ title: 'Other', url: 'https://three.test' }] },
] as TabGroup[];

it.each([['istanbul', ['name']], ['cafe', ['title']], ['العربية', ['tag']], ['', ['name', 'title', 'tag']]])(
  'manager list searches saved names, tabs and tags: %s', (query, ids) => {
    const result = evaluate(groups, [{ id: 'ar', name: 'العَرَبِيَّة' }], query, searchText.matchesSearch, searchText.normalizeForSearch);
    expect(result.map((group: TabGroup) => group.id)).toEqual(ids);
  },
);
it('manager performance count agrees with matching displayed rows', () => {
  expect(countVisibleTabRowsForGroupList(groups, { collapsedGroups: new Map(), search: 'cafe' })).toBe(1);
  expect(countVisibleTabRowsForGroupList(groups, { collapsedGroups: new Map(), search: 'istanbul' })).toBe(1);
});
