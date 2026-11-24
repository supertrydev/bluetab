import type { Settings, TabGroup, Tag } from '@/types/models';
import { Storage } from '@/utils/storage';
import { ThemeManager } from '@/utils/theme';
import { textSizeService } from '@/utils/TextSizeService';
import { isValidTextSize } from '@/types/text-size';
import { ArchiveStorageService } from '@/utils/archive-storage';
import { canAccessFeature } from '@/utils/feature-gate';
import { FlowStorageService } from '@/utils/flow-storage';
import { GroupMemoryStorageService } from '@/utils/group-memory-storage';
import { RSSService } from '@/services/rss-service';

export interface BlueTabBackupImportResult {
  updatedGroups: TabGroup[];
  updatedSettings?: Settings;
  groupsImported: number;
  tabCount: number;
  archiveCount: number;
  flowRulesCount: number;
  groupMemoryCount: number;
  projectsCount: number;
  feedsCount: number;
}

type BackupPayload = Record<string, any>;

export async function importBlueTabBackup(data: unknown): Promise<BlueTabBackupImportResult> {
  if (!isBackupPayload(data)) {
    throw new Error('Invalid backup file: missing groups data');
  }

  console.log('Starting comprehensive import...');

  const originalToNewIdMap = new Map<string, string>();
  const tagIdMapping = await importTags(data.tags);
  const importedProjectIds = await importProjects(data.projects);
  const now = Date.now();

  const safeGroups = data.groups.map((group: TabGroup) => {
    const newGroupId = crypto.randomUUID();
    originalToNewIdMap.set(group.id, newGroupId);

    const mappedTags = (group.tags || []).map((oldTagId: string) => tagIdMapping.get(oldTagId) || oldTagId);
    const validProjectId = group.projectId && importedProjectIds.has(group.projectId)
      ? group.projectId
      : undefined;

    if (group.projectId && !validProjectId) {
      console.log(`Group "${group.name}" had invalid projectId ${group.projectId}, removing`);
    }

    return {
      ...group,
      id: newGroupId,
      tags: mappedTags,
      projectId: validProjectId,
      tabs: (group.tabs || []).map((tab) => ({
        ...tab,
        id: crypto.randomUUID(),
        groupId: newGroupId,
        tags: (tab.tags || []).map((oldTagId: string) => tagIdMapping.get(oldTagId) || oldTagId),
      })),
      modified: now,
    };
  });

  const currentGroups = await Storage.get<TabGroup[]>('groups') || [];
  const updatedGroups = [...currentGroups, ...safeGroups];
  await Storage.set('groups', updatedGroups);

  const updatedSettings = await importSettings(data.settings);
  await importTextSettings(data.textSettings);
  await importLayoutMode(data.layoutMode);
  await importCollapsedGroups(data.collapsedGroups, originalToNewIdMap);
  await importPinSettings(data.pinSettings, originalToNewIdMap);
  const archiveCount = await importArchives(data.archives, tagIdMapping);
  const flowRulesCount = await importFlowSettings(data.flowSettings, tagIdMapping);
  const groupMemoryCount = await importGroupMemory(data.groupMemory, tagIdMapping);
  const feedsCount = await importFeeds(data.rss);

  return {
    updatedGroups,
    updatedSettings,
    groupsImported: safeGroups.length,
    tabCount: safeGroups.reduce((sum, group) => sum + group.tabs.length, 0),
    archiveCount,
    flowRulesCount,
    groupMemoryCount,
    projectsCount: countNewProjects(data.projects),
    feedsCount,
  };
}

export function formatBlueTabBackupImportSuccess(result: BlueTabBackupImportResult): string {
  const parts = [`Imported ${result.groupsImported} group${result.groupsImported !== 1 ? 's' : ''}`];
  if (result.archiveCount > 0) parts.push(`${result.archiveCount} archive${result.archiveCount !== 1 ? 's' : ''}`);
  if (result.flowRulesCount > 0) parts.push(`${result.flowRulesCount} Flow rule${result.flowRulesCount !== 1 ? 's' : ''}`);
  if (result.groupMemoryCount > 0) parts.push(`${result.groupMemoryCount} remembered group${result.groupMemoryCount !== 1 ? 's' : ''}`);
  if (result.projectsCount > 0) parts.push(`${result.projectsCount} project${result.projectsCount !== 1 ? 's' : ''}`);
  if (result.feedsCount > 0) parts.push(`${result.feedsCount} feed${result.feedsCount !== 1 ? 's' : ''}`);
  return `${parts.join(', ')} successfully!`;
}

function isBackupPayload(data: unknown): data is BackupPayload & { groups: TabGroup[] } {
  return typeof data === 'object'
    && data !== null
    && Array.isArray((data as BackupPayload).groups);
}

async function importTags(tags: unknown): Promise<Map<string, string>> {
  const tagIdMapping = new Map<string, string>();
  if (!Array.isArray(tags)) return tagIdMapping;

  console.log('Importing tags from backup:', tags.length);

  const currentTags = await Storage.get<Tag[]>('tags') || [];
  const existingTagNames = new Map(currentTags.map((tag) => [tag.name.toLowerCase(), tag.id]));
  const newTags: Tag[] = [];

  for (const importedTag of tags) {
    if (!isImportedTag(importedTag)) continue;

    const existingByName = existingTagNames.get(importedTag.name.toLowerCase());
    if (existingByName) {
      tagIdMapping.set(importedTag.id, existingByName);
    } else {
      const newId = crypto.randomUUID();
      tagIdMapping.set(importedTag.id, newId);
      newTags.push({
        ...importedTag,
        id: newId,
        created: Date.now(),
      });
    }
  }

  if (newTags.length > 0) {
    await Storage.set('tags', [...currentTags, ...newTags]);
  }

  return tagIdMapping;
}

function isImportedTag(value: unknown): value is Tag {
  return typeof value === 'object'
    && value !== null
    && typeof (value as Tag).id === 'string'
    && typeof (value as Tag).name === 'string';
}

async function importFeeds(rss: unknown): Promise<number> {
  if (!rss) return 0;
  try {
    return await RSSService.importBackup(rss);
  } catch (feedError) {
    console.error('Failed to import feeds:', feedError);
    return 0;
  }
}

async function importProjects(projects: unknown): Promise<Set<string>> {
  const currentProjects = await Storage.getProjects();
  const importedProjectIds = new Set(currentProjects.map((project) => project.id));

  if (!Array.isArray(projects) || projects.length === 0) {
    return importedProjectIds;
  }

  console.log('Importing projects from backup:', projects.length);

  try {
    const existingIds = new Set(currentProjects.map((project) => project.id));
    const newProjects = projects.filter((project) => project && !existingIds.has(project.id));

    if (newProjects.length > 0) {
      await Storage.set('projects', [...currentProjects, ...newProjects]);
      newProjects.forEach((project) => importedProjectIds.add(project.id));
    }
  } catch (projectError) {
    console.error('Failed to import projects:', projectError);
  }

  return importedProjectIds;
}

function countNewProjects(projects: unknown): number {
  return Array.isArray(projects) ? projects.length : 0;
}

async function importSettings(settings: unknown): Promise<Settings | undefined> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;

  const { autoBackup: _autoBackup, backupInterval: _backupInterval, ...cleanSettings } = settings as Record<string, unknown>;
  const updatedSettings = cleanSettings as unknown as Settings;

  console.log('Applying imported settings:', updatedSettings);
  await Storage.set('settings', updatedSettings);

  if (updatedSettings.theme) {
    ThemeManager.applyTheme(updatedSettings.theme);
  }

  return updatedSettings;
}

async function importTextSettings(textSettings: unknown): Promise<void> {
  if (!textSettings) return;

  try {
    if (chrome.storage.sync?.set) {
      await chrome.storage.sync.set({ bluetab_text_size_settings: textSettings });
    }
    const size = typeof textSettings === 'object' && textSettings !== null
      ? (textSettings as { textSize?: unknown }).textSize
      : undefined;
    if (typeof size === 'string' && isValidTextSize(size)) {
      await textSizeService.applyTextSize(size);
    }
  } catch (textError) {
    console.error('Failed to import text settings:', textError);
  }
}

async function importLayoutMode(layoutMode: unknown): Promise<void> {
  if (!layoutMode) return;

  try {
    await Storage.set('layoutMode', layoutMode);
  } catch (layoutError) {
    console.error('Failed to import layout mode:', layoutError);
  }
}

async function importCollapsedGroups(
  collapsedGroups: unknown,
  originalToNewIdMap: Map<string, string>,
): Promise<void> {
  if (!collapsedGroups || typeof collapsedGroups !== 'object' || Array.isArray(collapsedGroups)) return;

  try {
    const mappedCollapsedGroups: Record<string, boolean> = {};
    for (const [oldGroupId, isCollapsed] of Object.entries(collapsedGroups)) {
      const newGroupId = originalToNewIdMap.get(oldGroupId);
      if (newGroupId) {
        mappedCollapsedGroups[newGroupId] = Boolean(isCollapsed);
      }
    }
    await Storage.set('collapsedGroups', mappedCollapsedGroups);
  } catch (collapseError) {
    console.error('Failed to import collapsed groups:', collapseError);
  }
}

async function importPinSettings(
  pinSettings: unknown,
  originalToNewIdMap: Map<string, string>,
): Promise<void> {
  if (!pinSettings || typeof pinSettings !== 'object' || !('pinnedGroups' in pinSettings)) return;

  try {
    const existingPinSettings = await Storage.getPinSettings();
    const newPinSettings = { ...existingPinSettings };
    const pinnedGroups = (pinSettings as { pinnedGroups?: Record<string, unknown> }).pinnedGroups || {};

    for (const [oldGroupId, pinData] of Object.entries(pinnedGroups)) {
      const newGroupId = originalToNewIdMap.get(oldGroupId);
      if (newGroupId && pinData) {
        newPinSettings.pinnedGroups[newGroupId] = pinData as { isPinned: boolean; pinnedAt: number };
      }
    }

    await Storage.set('pinSettings', newPinSettings);
  } catch (pinError) {
    console.error('Failed to import pin settings:', pinError);
  }
}

async function importArchives(archives: unknown, tagIdMapping: Map<string, string>): Promise<number> {
  if (!archives || typeof archives !== 'object' || Array.isArray(archives)) return 0;

  let archiveCount = 0;
  try {
    for (const [originalId, archive] of Object.entries(archives)) {
      try {
        const archiveData = archive as Record<string, any>;
        const newId = crypto.randomUUID();
        const newArchive: any = {
          ...archiveData,
          id: newId,
          checksum: undefined,
        };

        if (!newArchive.protection?.passwordProtected && newArchive.originalGroup) {
          newArchive.originalGroup = {
            ...newArchive.originalGroup,
            id: newId,
            tags: newArchive.originalGroup.tags?.map((oldTagId: string) => tagIdMapping.get(oldTagId) || oldTagId) || [],
          };
        }

        console.log(`Importing archive: ${originalId} -> ${newArchive.id}`);
        await ArchiveStorageService.storeArchive(newArchive);
        archiveCount += 1;
      } catch (singleArchiveError) {
        console.error(`Failed to import archive ${originalId}:`, singleArchiveError);
      }
    }
  } catch (archiveError) {
    console.error('Failed to import archives:', archiveError);
  }

  return archiveCount;
}

async function importFlowSettings(flowSettings: unknown, tagIdMapping: Map<string, string>): Promise<number> {
  if (!flowSettings || typeof flowSettings !== 'object') return 0;
  const rules = (flowSettings as { rules?: unknown[] }).rules;
  if (!Array.isArray(rules) || rules.length === 0) return 0;

  try {
    const accessResult = await canAccessFeature('flow');
    if (!accessResult.allowed) {
      console.log('Flow import skipped: user is not Pro');
      return 0;
    }

    const currentFlowSettings = await FlowStorageService.getFlowSettings();
    const now = Date.now();
    const importedRules = rules.map((rule: any, index: number) => ({
      ...rule,
      id: crypto.randomUUID(),
      created: now,
      modified: now,
      priority: currentFlowSettings.rules.length + index,
      triggerCount: 0,
      action: rule.action
        ? {
          ...rule.action,
          tags: rule.action.tags?.map((oldTagId: string) => tagIdMapping.get(oldTagId) || oldTagId),
        }
        : rule.action,
    }));

    await FlowStorageService.setFlowSettings({
      ...currentFlowSettings,
      rules: [...currentFlowSettings.rules, ...importedRules],
      enabled: (flowSettings as { enabled?: boolean }).enabled ?? currentFlowSettings.enabled,
    });

    return importedRules.length;
  } catch (flowError) {
    console.error('Failed to import Flow settings:', flowError);
    return 0;
  }
}

async function importGroupMemory(groupMemory: unknown, tagIdMapping: Map<string, string>): Promise<number> {
  if (!groupMemory || typeof groupMemory !== 'object') return 0;
  const groups = (groupMemory as { groups?: Record<string, unknown> }).groups;
  if (!groups || typeof groups !== 'object') return 0;

  let groupMemoryCount = 0;
  try {
    const currentMemory = await GroupMemoryStorageService.getMemory();
    for (const rememberedGroup of Object.values(groups)) {
      const group = rememberedGroup as Record<string, any>;
      const newGroupId = crypto.randomUUID();
      const mappedTags = (group.tags || []).map((oldTagId: string) => tagIdMapping.get(oldTagId) || oldTagId);
      currentMemory.groups[newGroupId] = {
        ...group,
        id: newGroupId,
        tags: mappedTags,
        rememberedAt: Date.now(),
      } as any;

      if (Array.isArray(group.tabs)) {
        for (const tab of group.tabs) {
          if (tab.url) {
            currentMemory.urlIndex[tab.url] = newGroupId;
          }
        }
      }
      groupMemoryCount += 1;
    }
    await Storage.set('groupMemory', currentMemory);
  } catch (memoryError) {
    console.error('Failed to import group memory:', memoryError);
  }

  return groupMemoryCount;
}
