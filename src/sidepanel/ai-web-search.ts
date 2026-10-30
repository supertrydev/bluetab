export type WebSearchFreshness = 'day' | 'week' | 'month' | 'year';

export interface AISearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface OpenedSearchResult extends AISearchResult {
  tabId: number;
}

const ACADEMIC_DOMAINS = [
  'scholar.google',
  'arxiv.org',
  'pubmed.ncbi',
  'ieee.org',
  'acm.org',
  'researchgate.net',
  'doi.org',
  'sciencedirect.com',
  'springer.com',
  'jstor.org',
  'semanticscholar.org',
];

const DAY_PATTERN = /\b(today|breaking|just now)\b/i;
const WEEK_PATTERN = /\b(this week|weekly)\b/i;
const MONTH_PATTERN = /\b(latest|recent|current|newest|new)\b/i;
const YEAR_PATTERN = /\b(this year|2026|2025)\b/i;

function isAcademicResult(url: string): boolean {
  return ACADEMIC_DOMAINS.some((domain) => url.includes(domain));
}

export function inferSearchFreshness(query: string): WebSearchFreshness | undefined {
  if (!query.trim()) return undefined;
  if (DAY_PATTERN.test(query)) return 'day';
  if (WEEK_PATTERN.test(query)) return 'week';
  if (MONTH_PATTERN.test(query)) return 'month';
  if (YEAR_PATTERN.test(query)) return 'year';
  return undefined;
}

export function sortSearchResults(results: AISearchResult[]): AISearchResult[] {
  const academic = results.filter((result) => isAcademicResult(result.url));
  const nonAcademic = results.filter((result) => !isAcademicResult(result.url));
  return [...academic, ...nonAcademic].slice(0, 10);
}

export async function openSearchResults(
  results: AISearchResult[],
  query: string,
  tabsApi: Pick<typeof chrome.tabs, 'create' | 'group' | 'update'> = chrome.tabs,
  tabGroupsApi: Pick<typeof chrome.tabGroups, 'update'> = chrome.tabGroups,
): Promise<{
  openedResults: OpenedSearchResult[];
  openedTabIds: number[];
  openedCount: number;
  firstTabId?: number;
  groupId?: number;
}> {
  let groupId: number | undefined;
  let firstTabId: number | undefined;
  const openedResults: OpenedSearchResult[] = [];

  for (const result of results) {
    try {
      const tab = await tabsApi.create({ url: result.url, active: false });
      if (typeof tab.id !== 'number') {
        continue;
      }

      if (!firstTabId) {
        firstTabId = tab.id;
      }

      try {
        if (!groupId) {
          groupId = await tabsApi.group({ tabIds: [tab.id] });
          await tabGroupsApi.update(groupId, {
            title: query.slice(0, 30),
            color: 'blue',
          });
        } else {
          await tabsApi.group({ tabIds: [tab.id], groupId });
        }
      } catch {
        // Grouping is best-effort only.
      }

      openedResults.push({
        tabId: tab.id,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
      });
    } catch {
      // Skip individual tab open failures so the whole research batch survives.
    }
  }

  if (typeof firstTabId === 'number') {
    try {
      await tabsApi.update(firstTabId, { active: true });
    } catch {
      // Focusing the first opened result is best-effort only.
    }
  }

  return {
    openedResults,
    openedTabIds: openedResults.map((result) => result.tabId),
    openedCount: openedResults.length,
    firstTabId,
    groupId,
  };
}
