/** One locale-independent fold for user-entered searches across saved content. */
function foldSearchText(text: string): string {
  // Compatibility decomposition can itself produce a dotless i.
  return text.replace(/[\u0130I\u0131]/g, 'i').normalize('NFKD').replace(/[\u0130I\u0131]/g, 'i').replace(/\p{M}/gu, '');
}

export function normalizeForSearch(text: string): string {
  return foldSearchText(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function matchesSearch(haystack: string, query: string): boolean {
  return normalizeForSearch(haystack).includes(normalizeForSearch(query));
}

/** Return UTF-16 offsets into the original text, including its combining marks. */
export function findSearchMatch(
  text: string,
  query: string,
  fromIndex = 0,
): { start: number; end: number } | null {
  const needle = normalizeForSearch(query);
  if (!needle) return null;

  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const start = offset;
    offset += character.length;
    const fragment = foldSearchText(character);
    if (!fragment && ends.length) ends[ends.length - 1] = offset;
    for (const unit of fragment) {
      if (/\s/u.test(unit)) {
        if (!folded) continue;
        if (folded.endsWith(' ')) {
          ends[ends.length - 1] = offset;
          continue;
        }
        folded += ' ';
        starts.push(start);
        ends.push(offset);
      } else {
        folded += unit;
        for (let i = 0; i < unit.length; i++) {
          starts.push(start);
          ends.push(offset);
        }
      }
    }
  }
  folded = folded.trimEnd().toLowerCase();
  const searchStart = starts.findIndex((start) => start >= fromIndex);
  if (searchStart === -1) return null;
  const index = folded.indexOf(needle, searchStart);
  return index === -1 ? null : { start: starts[index], end: ends[index + needle.length - 1] };
}
