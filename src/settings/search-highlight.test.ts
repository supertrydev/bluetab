/** @jest-environment jsdom */

import { findSearchHits } from './search-highlight';

const build = (html: string) => {
  const section = document.createElement('div');
  section.innerHTML = html;
  // jsdom has no layout: only elements marked hidden count as invisible.
  section.querySelectorAll('*').forEach((element) => {
    element.getClientRects = () => (element.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
  return section;
};
const texts = (html: string, query: string) => findSearchHits(build(html), 's', query).map((hit) => hit.range?.toString());

describe('settings search hits', () => {
  it('points at the exact words, every time they occur', () => {
    expect(texts('<p>Open tabs</p><p>Close tabs and tabs</p>', 'TABS')).toEqual(['tabs', 'tabs', 'tabs']);
  });

  it('skips text that is not shown', () => {
    expect(texts('<p hidden>tabs</p><p>tabs</p>', 'tabs')).toHaveLength(1);
  });

  it('falls back to single words when the phrase is not written together', () => {
    expect(texts('<p>Window</p><p>current</p>', 'current window')).toEqual(['current', 'Window']);
  });

  it('points at the field when only its placeholder matches', () => {
    const [hit] = findSearchHits(build('<input placeholder="Add a site">'), 's', 'add a site');
    expect(hit.range).toBeUndefined();
    expect(hit.element.tagName).toBe('INPUT');
  });
});
