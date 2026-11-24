/**
 * @module services/rss-discovery
 *
 * WHY:  People know the address of a site, not of its feed.
 *
 * WHAT: Reads the feed links a web page announces in its head.
 *
 * HOW:  Plain text matching, so it also runs where there is no DOM.
 *
 * NOT:  Does not fetch anything.
 */

import type { DiscoveredFeed } from '@/types/rss';

const FEED_TYPE = /^application\/(?:rss|atom|rdf)\+xml$/i;

/** Where sites usually keep a feed they do not announce. */
export const WELL_KNOWN_FEED_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? match;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function readAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    attributes[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

export function discoverFeedLinks(html: string, pageUrl: string): DiscoveredFeed[] {
  const found = new Map<string, DiscoveredFeed>();
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const { rel = '', type = '', href, title = '' } = readAttributes(tag);
    if (!href || !FEED_TYPE.test(type.trim()) || !/(?:^|\s)alternate(?:\s|$)/i.test(rel)) continue;
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (!found.has(url.toString())) found.set(url.toString(), { url: url.toString(), title: title.trim() });
    } catch {
      // Not an address.
    }
  }
  return [...found.values()];
}
