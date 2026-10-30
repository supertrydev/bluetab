import type { TabGroup, TabItem } from '../types/models';

export interface BookmarkNode {
    id: string;
    title: string;
    url?: string;
    children?: BookmarkNode[];
}

/**
 * Map Chrome Bookmarks API tree to our common BookmarkNode format.
 * Chrome returns a single invisible root node; we skip it and return its children.
 */
export function parseChromeBookmarks(tree: chrome.bookmarks.BookmarkTreeNode[]): BookmarkNode[] {
    const mapNode = (node: chrome.bookmarks.BookmarkTreeNode): BookmarkNode => ({
        id: node.id,
        title: node.title || 'Untitled',
        url: node.url,
        children: node.children ? node.children.map(mapNode) : undefined,
    });

    // Chrome root node (id: "0") is invisible – skip it
    if (tree.length === 1 && !tree[0].url && tree[0].children) {
        return tree[0].children.map(mapNode);
    }
    return tree.map(mapNode);
}

/**
 * Parse a Netscape Bookmark Format HTML file into our common BookmarkNode tree.
 * Handles Chrome, Firefox, Edge and Safari exports.
 */
export function parseBookmarkHTML(html: string): BookmarkNode[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rootDL = doc.querySelector('dl');
    if (!rootDL) return [];
    return parseDL(rootDL);
}

function parseDL(dl: Element): BookmarkNode[] {
    const nodes: BookmarkNode[] = [];
    const children = Array.from(dl.children);
    let i = 0;

    while (i < children.length) {
        const el = children[i];

        if (el.tagName === 'DT') {
            const h3 = el.querySelector('h3');
            const a = el.querySelector('a');

            if (h3) {
                // Folder: find next DL sibling (sub-folder contents)
                let subDL: Element | null = null;
                let j = i + 1;
                while (j < children.length && children[j].tagName !== 'DL') j++;
                if (j < children.length && children[j].tagName === 'DL') {
                    subDL = children[j];
                    i = j; // skip the DL on next iteration
                }

                nodes.push({
                    id: crypto.randomUUID(),
                    title: h3.textContent?.trim() || 'Folder',
                    children: subDL ? parseDL(subDL) : [],
                });
            } else if (a) {
                const href = a.getAttribute('href') || '';
                // Skip internal Firefox/Chrome placeholders
                if (href && !href.startsWith('javascript:') && !href.startsWith('place:')) {
                    nodes.push({
                        id: crypto.randomUUID(),
                        title: a.textContent?.trim() || 'Untitled',
                        url: href,
                    });
                }
            }
        }

        i++;
    }

    return nodes;
}

/** Count total bookmarks (leaf nodes) under a node, including sub-folders. */
export function countBookmarks(node: BookmarkNode): number {
    if (node.url) return 1;
    return (node.children || []).reduce((sum, c) => sum + countBookmarks(c), 0);
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

function collectAllTabs(
    folder: BookmarkNode,
    groupId: string,
    existingUrls: Set<string>,
    duplicateHandling: 'allow' | 'reject',
): TabItem[] {
    const tabs: TabItem[] = [];
    for (const child of folder.children || []) {
        if (child.url) {
            if (duplicateHandling === 'reject' && existingUrls.has(child.url)) continue;
            tabs.push({
                id: crypto.randomUUID(),
                url: child.url,
                title: child.title || 'Untitled',
                timestamp: Date.now(),
                groupId,
            });
            existingUrls.add(child.url);
        } else if (child.children) {
            tabs.push(...collectAllTabs(child, groupId, existingUrls, duplicateHandling));
        }
    }
    return tabs;
}

function processFolderSeparate(
    folder: BookmarkNode,
    result: TabGroup[],
    existingUrls: Set<string>,
    duplicateHandling: 'allow' | 'reject',
    now: number,
): void {
    const groupId = crypto.randomUUID();
    const directTabs: TabItem[] = [];

    for (const child of folder.children || []) {
        if (child.url) {
            if (duplicateHandling === 'reject' && existingUrls.has(child.url)) continue;
            directTabs.push({
                id: crypto.randomUUID(),
                url: child.url,
                title: child.title || 'Untitled',
                timestamp: now,
                groupId,
            });
            existingUrls.add(child.url);
        }
    }

    if (directTabs.length > 0) {
        result.push({
            id: groupId,
            name: folder.title || 'Bookmarks',
            tabs: directTabs,
            created: now,
            modified: now,
        });
    }

    // Recurse into sub-folders
    for (const child of folder.children || []) {
        if (child.children) {
            processFolderSeparate(child, result, existingUrls, duplicateHandling, now);
        }
    }
}

/**
 * Convert selected bookmark folders to TabGroups.
 *
 * @param treeNodes   Full bookmark tree
 * @param selectedIds Set of folder IDs the user checked
 * @param nestedMode  'separate' = one group per folder level | 'merge' = flatten all into one group
 * @param existingGroups  Used for duplicate URL detection
 * @param duplicateHandling  From Settings
 */
export function convertToTabGroups(
    treeNodes: BookmarkNode[],
    selectedIds: Set<string>,
    nestedMode: 'separate' | 'merge',
    existingGroups: TabGroup[],
    duplicateHandling: 'allow' | 'reject',
): TabGroup[] {
    const result: TabGroup[] = [];
    const existingUrls = duplicateHandling === 'reject'
        ? new Set(existingGroups.flatMap(g => g.tabs.map(t => t.url)))
        : new Set<string>();
    const now = Date.now();

    function traverse(nodes: BookmarkNode[]): void {
        for (const node of nodes) {
            if (!node.children) continue;

            if (selectedIds.has(node.id)) {
                // Process this selected folder; don't recurse into children
                // (they're handled within the folder processing)
                if (nestedMode === 'merge') {
                    const groupId = crypto.randomUUID();
                    const tabs = collectAllTabs(node, groupId, existingUrls, duplicateHandling);
                    if (tabs.length > 0) {
                        result.push({
                            id: groupId,
                            name: node.title || 'Bookmarks',
                            tabs,
                            created: now,
                            modified: now,
                        });
                    }
                } else {
                    processFolderSeparate(node, result, existingUrls, duplicateHandling, now);
                }
            } else {
                // Not selected – recurse to find selected descendants
                traverse(node.children);
            }
        }
    }

    traverse(treeNodes);
    return result;
}
