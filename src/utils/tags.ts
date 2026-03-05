import type { Tag, TabGroup, TabItem } from '../types/models';

export const TAG_COLORS = [
    '#433cae', // Persian blue
    '#1c6db8', // Azul
    '#32b3e0', // Process Cyan
    '#089477', // Zomp
    '#2ead28', // Kelly green
    '#d4a800', // Dark yellow (better contrast)
    '#fa8726', // UT orange
    '#eb1f25', // Red (CMYK)
    '#d30f73', // Magenta dye
    '#823cc1', // Blue Violet
];

export class TagManager {
    static createTag(name: string, color?: string): Tag {
        return {
            id: crypto.randomUUID(),
            name: name.trim(),
            color: color || TAG_COLORS[0],
            created: Date.now()
        };
    }

    static getRandomColor(): string {
        return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
    }

    static validateTagName(name: string, existingTags: Tag[]): string | null {
        const trimmed = name.trim();

        if (!trimmed) return 'Tag name cannot be empty';
        if (trimmed.length > 50) return 'Tag name too long (max 50 characters)';
        if (existingTags.some(tag => tag.name.toLowerCase() === trimmed.toLowerCase())) {
            return 'Tag name already exists';
        }

        return null;
    }

    static addTagToGroup(group: TabGroup, tagId: string): TabGroup {
        const existingTags = group.tags || [];
        if (existingTags.includes(tagId)) return group;

        return {
            ...group,
            tags: [...existingTags, tagId],
            modified: Date.now()
        };
    }

    static removeTagFromGroup(group: TabGroup, tagId: string): TabGroup {
        const existingTags = group.tags || [];

        return {
            ...group,
            tags: existingTags.filter(id => id !== tagId),
            modified: Date.now()
        };
    }

    static addTagToTab(tab: TabItem, tagId: string): TabItem {
        const existingTags = tab.tags || [];
        if (existingTags.includes(tagId)) return tab;

        return {
            ...tab,
            tags: [...existingTags, tagId]
        };
    }

    static removeTagFromTab(tab: TabItem, tagId: string): TabItem {
        const existingTags = tab.tags || [];

        return {
            ...tab,
            tags: existingTags.filter(id => id !== tagId)
        };
    }

    static getTagsByIds(tagIds: string[], allTags: Tag[]): Tag[] {
        return tagIds
            .map(id => allTags.find(tag => tag.id === id))
            .filter((tag): tag is Tag => tag !== undefined);
    }

    static filterGroupsByTag(groups: TabGroup[], tagId: string): TabGroup[] {
        return groups.filter(group =>
            (group.tags && group.tags.includes(tagId)) ||
            group.tabs.some(tab => tab.tags && tab.tags.includes(tagId))
        );
    }

    static filterTabsByTag(tabs: TabItem[], tagId: string): TabItem[] {
        return tabs.filter(tab => tab.tags && tab.tags.includes(tagId));
    }

    static getTagUsageCount(tagId: string, groups: TabGroup[]): { groups: number; tabs: number } {
        let groupCount = 0;
        let tabCount = 0;

        groups.forEach(group => {
            if (group.tags && group.tags.includes(tagId)) {
                groupCount++;
            }

            group.tabs.forEach(tab => {
                if (tab.tags && tab.tags.includes(tagId)) {
                    tabCount++;
                }
            });
        });

        return { groups: groupCount, tabs: tabCount };
    }

    static getPopularTags(groups: TabGroup[], allTags: Tag[], limit = 5): Tag[] {
        const tagUsage = allTags.map(tag => ({
            tag,
            usage: this.getTagUsageCount(tag.id, groups)
        }));

        return tagUsage
            .sort((a, b) => (b.usage.groups + b.usage.tabs) - (a.usage.groups + a.usage.tabs))
            .slice(0, limit)
            .map(item => item.tag);
    }

    static cleanupUnusedTags(tags: Tag[], groups: TabGroup[]): Tag[] {
        return tags.filter(tag => {
            const usage = this.getTagUsageCount(tag.id, groups);
            return usage.groups > 0 || usage.tabs > 0;
        });
    }
}

export default TagManager;