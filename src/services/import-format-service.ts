import type { Settings, TabGroup, TabItem } from '@/types/models';
import {
  convertToTabGroups,
  parseBookmarkHTML,
  type BookmarkNode,
} from './bookmark-import-service';

export type ImportFormat =
  | 'bluetab-backup'
  | 'bookmark-html'
  | 'tab-list'
  | 'generic-json'
  | 'unsupported';

export interface ImportDetection {
  format: ImportFormat;
  label: string;
}

export interface ImportAnalysis extends ImportDetection {
  groupCount: number;
  tabCount: number;
  skippedInvalidUrls: string[];
  skippedDuplicates: string[];
  warnings: string[];
  groups?: TabGroup[];
  backupData?: unknown;
  error?: string;
}

interface AnalyzeImportFileOptions {
  fileName: string;
  content: string;
  existingGroups: TabGroup[];
  duplicateHandling: Settings['duplicateHandling'];
}

type UrlCandidate = {
  url: string;
  title?: string;
};

type MutableGroupDraft = {
  name: string;
  tabs: UrlCandidate[];
};

const FORMAT_LABELS: Record<ImportFormat, string> = {
  'bluetab-backup': 'Bluetab Backup',
  'bookmark-html': 'Bookmark HTML',
  'tab-list': 'Tab List',
  'generic-json': 'JSON',
  unsupported: 'Unsupported',
};

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

export function detectImportFormat(fileName: string, content: string): ImportDetection {
  const normalizedName = fileName.toLowerCase();
  const trimmed = content.trim();

  if (looksLikeBookmarkHTML(normalizedName, trimmed)) {
    return { format: 'bookmark-html', label: FORMAT_LABELS['bookmark-html'] };
  }

  if (normalizedName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isBlueTabBackupPayload(parsed)) {
        return { format: 'bluetab-backup', label: FORMAT_LABELS['bluetab-backup'] };
      }
      if (countGenericJsonTabs(parsed) > 0) {
        return { format: 'generic-json', label: FORMAT_LABELS['generic-json'] };
      }
      // Valid JSON without tabs we understand: never read it as a text list,
      // that turned the raw JSON line into a tab title.
      return { format: 'unsupported', label: FORMAT_LABELS.unsupported };
    } catch {
      return { format: 'unsupported', label: FORMAT_LABELS.unsupported };
    }
  }

  if (extractUrlFromText(trimmed)) {
    return { format: 'tab-list', label: FORMAT_LABELS['tab-list'] };
  }

  return { format: 'unsupported', label: FORMAT_LABELS.unsupported };
}

export function analyzeImportFile({
  fileName,
  content: rawContent,
  existingGroups,
  duplicateHandling,
}: AnalyzeImportFileOptions): ImportAnalysis {
  // Some tools write a byte order mark first, which JSON.parse rejects.
  const content = rawContent.replace(/^\uFEFF/, '');
  const detection = detectImportFormat(fileName, content);
  const duplicateTracker = createDuplicateTracker(existingGroups, duplicateHandling);

  if (detection.format === 'unsupported') {
    return unsupported('No importable tabs or Bluetab backup data found.');
  }

  if (detection.format === 'bluetab-backup') {
    try {
      const backupData = JSON.parse(content);
      const groups = getBackupGroups(backupData);
      const tabCount = groups.reduce((sum, group) => sum + getTabsArray(group).length, 0);

      return {
        ...detection,
        groupCount: groups.length,
        tabCount,
        skippedInvalidUrls: [],
        skippedDuplicates: [],
        warnings: [],
        backupData,
      };
    } catch {
      return unsupported('This backup file could not be parsed.');
    }
  }

  if (detection.format === 'bookmark-html') {
    try {
      const nodes = parseBookmarkHTML(content);
      const selectedIds = new Set(collectFolderIds(nodes));
      const groups = convertToTabGroups(
        nodes,
        selectedIds,
        'separate',
        existingGroups,
        duplicateHandling,
      );

      return buildExternalAnalysis(detection, groups, [], duplicateTracker.skippedDuplicates, [
        'All bookmark folders in this file will be imported as separate groups.',
      ]);
    } catch {
      return unsupported('This bookmark HTML file could not be parsed.');
    }
  }

  if (detection.format === 'generic-json') {
    try {
      const parsed = JSON.parse(content);
      const { groups, skippedInvalidUrls } = groupsFromGenericJson(
        parsed,
        nameFromFile(fileName, 'Imported JSON'),
        duplicateTracker,
      );
      return buildExternalAnalysis(detection, groups, skippedInvalidUrls, duplicateTracker.skippedDuplicates);
    } catch {
      return unsupported('This JSON file could not be parsed.');
    }
  }

  const { groups, skippedInvalidUrls } = groupsFromPlainText(
    content,
    nameFromFile(fileName, 'Imported Tabs'),
    duplicateTracker,
  );
  return buildExternalAnalysis(detection, groups, skippedInvalidUrls, duplicateTracker.skippedDuplicates);
}

function buildExternalAnalysis(
  detection: ImportDetection,
  groups: TabGroup[],
  skippedInvalidUrls: string[],
  skippedDuplicates: string[],
  warnings: string[] = [],
): ImportAnalysis {
  const tabCount = groups.reduce((sum, group) => sum + group.tabs.length, 0);
  if (tabCount === 0) {
    return unsupported('No importable tabs were found in this file.');
  }

  return {
    ...detection,
    groupCount: groups.length,
    tabCount,
    skippedInvalidUrls,
    skippedDuplicates,
    warnings,
    groups,
  };
}

function unsupported(error: string): ImportAnalysis {
  return {
    format: 'unsupported',
    label: FORMAT_LABELS.unsupported,
    groupCount: 0,
    tabCount: 0,
    skippedInvalidUrls: [],
    skippedDuplicates: [],
    warnings: [],
    error,
  };
}

function looksLikeBookmarkHTML(fileName: string, content: string): boolean {
  return fileName.endsWith('.html')
    || fileName.endsWith('.htm')
    || /NETSCAPE-Bookmark-file-1/i.test(content)
    || /<DT>\s*<A\s+HREF=/i.test(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlueTabBackupPayload(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.groups)) return false;

  return typeof value.version === 'string'
    || typeof value.exportedAt === 'number'
    || isRecord(value.settings)
    || isRecord(value.pinSettings)
    || isRecord(value.archives)
    || Array.isArray(value.tags)
    || Array.isArray(value.projects)
    || isRecord(value.groupMemory)
    || isRecord(value.flowSettings);
}

function getBackupGroups(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.groups)) return [];
  return value.groups.filter(isRecord);
}

function getTabsArray(group: Record<string, unknown>): unknown[] {
  return Array.isArray(group.tabs) ? group.tabs : [];
}

/** The links of a group-like record, whatever the exporting tool called them. */
function jsonTabList(record: Record<string, unknown>): unknown {
  return record.tabs ?? record.items ?? record.links ?? record.cards;
}

type JsonGroupEntry = { name: string | null; tabs: unknown };

/** "name" wins over "title", as in Session Buddy's own format. */
function recordName(record: Record<string, unknown>): string | null {
  return stringValue(record.name) || stringValue(record.title);
}

/**
 * Group-like entries of a JSON export, or null when the shape is not a known
 * grouped export:
 * - `groups`: Bluetab-like groups, or workspaces with collections in `lists`.
 * - `collections` / `sessions`: Session Buddy v4 / v3 exports, where each
 *   collection holds windows in `folders` / `windows`.
 * - `folders` / `windows`: a single Session Buddy collection.
 */
function jsonEntries(value: unknown): JsonGroupEntry[] | null {
  if (!isRecord(value)) return null;
  if (Array.isArray(value.groups)) return jsonGroupEntries(value.groups);

  const collections = value.collections ?? value.sessions;
  if (Array.isArray(collections)) return collectionEntries(collections);

  const folders = value.folders ?? value.windows;
  if (Array.isArray(folders)) return folderEntries(folders, recordName(value));

  return null;
}

function collectionEntries(collections: unknown[]): JsonGroupEntry[] {
  const entries: JsonGroupEntry[] = [];
  for (const collection of collections) {
    if (!isRecord(collection)) continue;
    const folders = collection.folders ?? collection.windows;
    if (!Array.isArray(folders)) continue;
    entries.push(...folderEntries(folders, recordName(collection)));
  }
  return entries;
}

/**
 * One group per window/folder. A single-window collection keeps the collection
 * name; with several windows each group is "Collection · Folder".
 */
function folderEntries(folders: unknown[], collectionName: string | null): JsonGroupEntry[] {
  const records = folders.filter(isRecord);
  if (records.length === 1) {
    return [{ name: collectionName || recordName(records[0]), tabs: jsonTabList(records[0]) }];
  }

  return records.map((folder, index) => {
    const folderName = recordName(folder);
    const label = folderName || `Window ${index + 1}`;
    return {
      name: collectionName ? `${collectionName} · ${label}` : folderName,
      tabs: jsonTabList(folder),
    };
  });
}

/**
 * Groups of an exported `groups` array. A group that holds `lists` (a
 * workspace with collections inside) contributes one group per list.
 */
function jsonGroupEntries(groups: unknown[]): JsonGroupEntry[] {
  const entries: JsonGroupEntry[] = [];
  for (const group of groups) {
    if (!isRecord(group)) continue;
    if (Array.isArray(group.lists)) {
      for (const list of group.lists) {
        if (!isRecord(list)) continue;
        entries.push({ name: stringValue(list.title) || stringValue(list.name), tabs: jsonTabList(list) });
      }
      continue;
    }
    entries.push({ name: stringValue(group.name) || stringValue(group.title), tabs: jsonTabList(group) });
  }
  return entries;
}

function countGenericJsonTabs(value: unknown): number {
  if (Array.isArray(value)) {
    return value.filter((item) => extractJsonTabCandidate(item)).length;
  }

  if (!isRecord(value)) return 0;

  const entries = jsonEntries(value);
  if (entries) {
    return entries.reduce((sum, entry) => sum + countGenericJsonTabs(entry.tabs), 0);
  }

  return countGenericJsonTabs(jsonTabList(value));
}

function groupsFromGenericJson(
  value: unknown,
  fallbackName: string,
  duplicates: DuplicateTracker,
): { groups: TabGroup[]; skippedInvalidUrls: string[] } {
  const skippedInvalidUrls: string[] = [];
  const drafts: MutableGroupDraft[] = [];
  const entries = jsonEntries(value);

  if (Array.isArray(value)) {
    drafts.push({ name: fallbackName, tabs: collectJsonTabs(value, skippedInvalidUrls) });
  } else if (entries) {
    for (const [index, entry] of entries.entries()) {
      const tabs = collectJsonTabs(entry.tabs, skippedInvalidUrls);
      drafts.push({ name: entry.name || `${fallbackName} ${index + 1}`, tabs });
    }
  } else if (isRecord(value)) {
    const groupName = stringValue(value.name) || stringValue(value.title) || fallbackName;
    drafts.push({ name: groupName, tabs: collectJsonTabs(jsonTabList(value), skippedInvalidUrls) });
  }

  return { groups: buildGroupsFromDrafts(drafts, duplicates), skippedInvalidUrls };
}

function collectJsonTabs(value: unknown, skippedInvalidUrls: string[]): UrlCandidate[] {
  if (!Array.isArray(value)) return [];

  const tabs: UrlCandidate[] = [];
  for (const item of value) {
    const candidate = extractJsonTabCandidate(item);
    if (!candidate) continue;

    const normalized = normalizeImportUrl(candidate.url);
    if (!normalized) {
      skippedInvalidUrls.push(candidate.url);
      continue;
    }

    tabs.push({ url: normalized, title: candidate.title });
  }
  return tabs;
}

function extractJsonTabCandidate(value: unknown): UrlCandidate | null {
  if (typeof value === 'string') {
    return { url: value };
  }

  if (!isRecord(value)) return null;

  const rawUrl = stringValue(value.url) || stringValue(value.href) || stringValue(value.link);
  if (!rawUrl) return null;

  return {
    url: rawUrl,
    // A title the user renamed (customTitle) wins over the page title.
    title: stringValue(value.customTitle) || stringValue(value.title) || stringValue(value.name)
      || stringValue(value.text) || undefined,
  };
}

function groupsFromPlainText(
  content: string,
  fallbackName: string,
  duplicates: DuplicateTracker,
): { groups: TabGroup[]; skippedInvalidUrls: string[] } {
  const drafts: MutableGroupDraft[] = [];
  const skippedInvalidUrls: string[] = [];
  let current: MutableGroupDraft = { name: fallbackName, tabs: [] };
  let groupIndex = 1;

  const pushCurrent = () => {
    if (current.tabs.length > 0) {
      drafts.push(current);
      groupIndex += 1;
    }
    current = { name: groupIndex === 1 ? fallbackName : `${fallbackName} ${groupIndex}`, tabs: [] };
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      pushCurrent();
      continue;
    }

    if (line.startsWith('#')) {
      if (current.tabs.length > 0) pushCurrent();
      current.name = line.replace(/^#+/, '').trim() || current.name;
      continue;
    }

    const extracted = extractUrlFromText(line);
    if (!extracted) {
      skippedInvalidUrls.push(line);
      continue;
    }

    current.tabs.push({
      url: extracted.url,
      title: deriveTitleFromLine(line, extracted.raw, extracted.url),
    });
  }

  pushCurrent();
  return { groups: buildGroupsFromDrafts(drafts, duplicates), skippedInvalidUrls };
}

function buildGroupsFromDrafts(drafts: MutableGroupDraft[], duplicates: DuplicateTracker): TabGroup[] {
  const now = Date.now();
  const groups: TabGroup[] = [];

  for (const draft of drafts) {
    const groupId = crypto.randomUUID();
    const tabs: TabItem[] = [];

    for (const candidate of draft.tabs) {
      const url = normalizeImportUrl(candidate.url);
      if (!url || duplicates.shouldSkip(url)) continue;

      tabs.push({
        id: crypto.randomUUID(),
        url,
        title: candidate.title?.trim() || titleFromUrl(url),
        timestamp: now,
        groupId,
      });
    }

    if (tabs.length > 0) {
      groups.push({
        id: groupId,
        name: draft.name || 'Imported Tabs',
        tabs,
        created: now,
        modified: now,
      });
    }
  }

  return groups;
}

function extractUrlFromText(text: string): { url: string; raw: string } | null {
  const match = text.match(URL_PATTERN);
  const raw = match?.[0]?.replace(/[),.;]+$/, '');
  const normalized = raw ? normalizeImportUrl(raw) : null;
  return raw && normalized ? { url: normalized, raw } : null;
}

/**
 * The title around a URL on one line, e.g. OneTab's "url | title" or
 * "title | url". Only separators next to the URL are dropped, so dashes and
 * pipes inside the title ("Page - Site", "e-mail", "Docs | MDN") stay.
 */
function deriveTitleFromLine(line: string, rawUrl: string, url: string): string {
  const index = line.indexOf(rawUrl);
  const rest = index === -1
    ? line
    : `${line.slice(0, index)} ${line.slice(index + rawUrl.length)}`;
  const title = rest.trim().replace(/^[\s|–—-]+|[\s|–—-]+$/g, '').trim();

  return title || titleFromUrl(url);
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'Untitled';
  }
}

function normalizeImportUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function nameFromFile(fileName: string, fallback: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, '').trim();
  return baseName || fallback;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function collectFolderIds(nodes: BookmarkNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children !== undefined) {
      ids.push(node.id);
      ids.push(...collectFolderIds(node.children));
    }
  }
  return ids;
}

interface DuplicateTracker {
  skippedDuplicates: string[];
  shouldSkip: (url: string) => boolean;
}

function createDuplicateTracker(
  existingGroups: TabGroup[],
  duplicateHandling: Settings['duplicateHandling'],
): DuplicateTracker {
  const existingUrls = duplicateHandling === 'reject'
    ? new Set(existingGroups.flatMap((group) => group.tabs.map((tab) => tab.url)))
    : new Set<string>();
  const skippedDuplicates: string[] = [];

  return {
    skippedDuplicates,
    shouldSkip(url: string) {
      if (duplicateHandling !== 'reject') return false;
      if (existingUrls.has(url)) {
        skippedDuplicates.push(url);
        return true;
      }
      existingUrls.add(url);
      return false;
    },
  };
}
