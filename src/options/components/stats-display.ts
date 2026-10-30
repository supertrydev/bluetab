import type { TabGroup } from '@/types/models';

const TITLE_SEPARATORS = [' | ', ' - ', ' — ', ' – ', ' • ', ' · ', ' :: '];
const COMMON_SECOND_LEVEL_SUFFIXES = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function normalizeMatchToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function extractDomainLabel(domain: string): string {
  const labels = normalizeHostname(domain).split('.').filter(Boolean);

  if (labels.length === 0) {
    return '';
  }

  if (labels.length === 1) {
    return labels[0];
  }

  const topLevelLabel = labels[labels.length - 1];
  const secondLevelLabel = labels[labels.length - 2];

  if (
    labels.length >= 3 &&
    topLevelLabel.length === 2 &&
    COMMON_SECOND_LEVEL_SUFFIXES.has(secondLevelLabel)
  ) {
    return labels[labels.length - 3];
  }

  return secondLevelLabel;
}

function extractHostname(url: string): string | null {
  if (!url) return null;
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

export function formatDomainName(domain: string): string {
  const name = extractDomainLabel(domain) || normalizeHostname(domain);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function splitTitleSegments(title: string): string[] {
  const trimmed = title.trim();

  if (!trimmed) {
    return [];
  }

  for (const separator of TITLE_SEPARATORS) {
    if (!trimmed.includes(separator)) {
      continue;
    }

    return trimmed
      .split(separator)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  return [];
}

export function extractSiteTitleCandidate(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const segments = splitTitleSegments(trimmed);
  if (segments.length === 0) {
    return trimmed;
  }

  const ranked = segments
    .filter((segment) => segment.length > 1)
    .sort((left, right) => left.length - right.length || left.localeCompare(right));

  return ranked[0] ?? segments[0];
}

export function resolveDomainDisplayTitle(domain: string, groups: TabGroup[]): string {
  const normalizedDomain = normalizeHostname(domain);
  const domainToken = normalizeMatchToken(extractDomainLabel(normalizedDomain));
  const titleCandidates = new Map<string, { count: number; recency: number }>();

  for (const group of groups) {
    const recency = Math.max(group.modified ?? 0, group.created ?? 0);

    for (const tab of group.tabs) {
      const tabHostname = extractHostname(tab.url);
      if (tabHostname !== normalizedDomain) {
        continue;
      }

      const candidate = splitTitleSegments(tab.title)
        .filter((segment) => normalizeMatchToken(segment).includes(domainToken))
        .sort((left, right) => right.length - left.length || left.localeCompare(right))[0];

      if (!candidate) {
        continue;
      }

      const existing = titleCandidates.get(candidate);
      titleCandidates.set(candidate, {
        count: (existing?.count ?? 0) + 1,
        recency: Math.max(existing?.recency ?? 0, recency, tab.timestamp ?? 0),
      });
    }
  }

  if (titleCandidates.size === 0) {
    return formatDomainName(domain);
  }

  return [...titleCandidates.entries()]
    .sort((left, right) => {
      const [leftTitle, leftMeta] = left;
      const [rightTitle, rightMeta] = right;
      return (
        rightMeta.count - leftMeta.count ||
        rightMeta.recency - leftMeta.recency ||
        leftTitle.length - rightTitle.length ||
        leftTitle.localeCompare(rightTitle)
      );
    })[0][0];
}
