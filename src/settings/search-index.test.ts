/** @jest-environment jsdom */

import * as fs from 'fs';
import * as path from 'path';
import { SECTION_TRANSLATIONS, buildSectionSearchText, matchesSectionSearch } from './search-index';

const load = (locale: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, `../i18n/locales/${locale}.json`), 'utf-8'));
const english = load('en');
const turkish = load('tr');
const read = (source: unknown) => (key: string) =>
  key.split('.').reduce<any>((value, part) => value?.[part], source);
const mapped = Object.values(SECTION_TRANSLATIONS).flat();

describe('settings search index', () => {
  it('only points at translations that exist', () => {
    for (const key of mapped) expect([key, read(english)(key)]).not.toEqual([key, undefined]);
  });

  it('covers every settings text, so a new branch cannot be left out', () => {
    const branches = Object.keys(english.settings).filter((key) => !['page', 'general'].includes(key));
    expect(branches.filter((key) => !mapped.includes(`settings.${key}`))).toEqual([]);
    const general = Object.keys(english.settings.general).filter((key) => key !== 'joinerAnd');
    expect(general.filter((key) => !mapped.includes(`settings.general.${key}`))).toEqual([]);
  });

  it('keeps each general setting in exactly one section', () => {
    const general = mapped.filter((key) => key.startsWith('settings.general.'));
    expect(new Set(general).size).toBe(general.length);
  });

  it('finds text that is not on screen', () => {
    const text = buildSectionSearchText('floating-button', undefined, read(english));
    expect(matchesSectionSearch(text, 'Enable site access')).toBe(true);
    expect(matchesSectionSearch(text, 'bottom right')).toBe(true);
    expect(matchesSectionSearch(text, 'pomodoro')).toBe(false);
  });

  it('matches words in any order and ignores Turkish letter forms', () => {
    const text = buildSectionSearchText('group-memory', undefined, read(turkish));
    expect(matchesSectionSearch(text, 'HAFIZASI')).toBe(true);
    expect(matchesSectionSearch(text, 'haf\u0131zas\u0131')).toBe(true);
    expect(matchesSectionSearch('Open in the current window', 'window current')).toBe(true);
    expect(matchesSectionSearch('Open in the current window', 'window missing')).toBe(false);
  });

  it('reads labels and placeholders but never what the user typed', () => {
    const section = document.createElement('div');
    section.innerHTML = '<p>One</p><p>Two</p><input placeholder="Add a site" aria-label="Site"><input id="key">';
    section.querySelector<HTMLInputElement>('#key')!.value = 'secret-token';
    const text = buildSectionSearchText('unknown', section, () => undefined);
    expect(text).toContain('one two');
    expect(text).toContain('add a site');
    expect(text).not.toContain('secret');
  });
});
