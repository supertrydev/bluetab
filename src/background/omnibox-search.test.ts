import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as ts from 'typescript';
import { matchesSearch, normalizeForSearch } from '@/utils/search-text';

it('bt suggestions search multilingual saved group names, tab titles and URLs', async () => {
  const source = readFileSync(resolve(__dirname, 'service-worker.ts'), 'utf8');
  const listener = source.slice(source.indexOf('chrome.omnibox.onInputChanged.addListener'), source.indexOf('chrome.omnibox.onInputEntered.addListener'));
  let onInputChanged!: (text: string, suggest: jest.Mock) => Promise<void>;
  const groups = [{ id: 'one', name: '\u0130stanbul', tabs: [
    { title: 'Café', url: 'https://one.test' },
    { title: 'العَرَبِيَّة', url: 'https://two.test/\u0131\u015f\u0131k' },
  ] }];
  new Function('chrome', 'Storage', 'translate', 'escapeXml', 'matchesSearch', 'normalizeForSearch',
    ts.transpileModule(listener, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
  )(
    { omnibox: { onInputChanged: { addListener: (fn: typeof onInputChanged) => { onInputChanged = fn; } } } },
    { get: async () => groups }, (_key: string, values: object) => JSON.stringify(values), (text: string) => text,
    matchesSearch, normalizeForSearch,
  );
  for (const [query, content] of [['istanbul', 'group:one'], ['cafe', 'tab:https://one.test'], ['العربية', 'tab:https://two.test/\u0131\u015f\u0131k'], ['isik', 'tab:https://two.test/\u0131\u015f\u0131k']]) {
    const suggest = jest.fn();
    await onInputChanged(query, suggest);
    expect(suggest.mock.calls[0][0]).toEqual([expect.objectContaining({ content })]);
  }
});
