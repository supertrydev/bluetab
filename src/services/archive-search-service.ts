/**
 * Archive Search Service
 * ======================
 * WHY:  Users need to find tabs across hundreds of archived groups quickly.
 * WHAT: Full-text search with fuzzy matching, faceted results, relevance scoring.
 * HOW:  In-memory indexing, Levenshtein distance for fuzzy, TF-IDF-like scoring.
 * NOT:  Does not search encrypted archive contents (privacy by design).
 */

import { ArchivedGroup, ArchiveFilters } from '../types/archive';
import { ArchiveStorageService } from '../utils/archive-storage';
import { ArchiveErrorHandler } from '../utils/archive-error-handler';

export interface SearchQuery {
  text?: string;
  tags?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  protectionStatus?: 'all' | 'protected' | 'unprotected';
  minTabCount?: number;
  maxTabCount?: number;
  sortBy?: 'relevance' | 'date' | 'name' | 'size' | 'accessCount';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  archive: ArchivedGroup;
  relevanceScore: number;
  matchedFields: string[];
  highlights: {
    field: string;
    text: string;
    matchStart: number;
    matchEnd: number;
  }[];
}

export interface SearchStats {
  totalResults: number;
  protectedResults: number;
  averageRelevance: number;
  searchTime: number;
  facets: {
    byMonth: { [key: string]: number };
    byProtection: { protected: number; unprotected: number };
    byTabCount: { [range: string]: number };
  };
}

export interface AdvancedSearchOptions {
  fuzzyMatching?: boolean;
  includeTabContent?: boolean;
  caseSensitive?: boolean;
  wholeWords?: boolean;
  regexMode?: boolean;
  boostRecent?: boolean;
  boostAccessed?: boolean;
}

export class ArchiveSearchService {
  private static readonly DEFAULT_LIMIT = 50;
  private static readonly MAX_LIMIT = 500;

  /**
   * Perform a comprehensive search across archives
   */
  static async search(
    query: SearchQuery,
    options: AdvancedSearchOptions = {}
  ): Promise<{
    results: SearchResult[];
    stats: SearchStats;
    suggestions?: string[];
  }> {
    const startTime = Date.now();
    const context = { operation: 'search', query: query.text };

    try {
      // Get all archives
      const archiveStorage = await ArchiveStorageService.getArchives();
      let archives = Object.values(archiveStorage.archives);

      // Apply filters first
      archives = this.applyFilters(archives, query);

      // Perform text search if query provided
      let searchResults: SearchResult[] = [];
      if (query.text && query.text.trim()) {
        searchResults = await this.performTextSearch(archives, query.text, options);
      } else {
        // Convert to SearchResult format without text matching
        searchResults = archives.map(archive => ({
          archive,
          relevanceScore: this.calculateRelevanceScore(archive, query, options),
          matchedFields: [],
          highlights: []
        }));
      }

      // Sort results
      searchResults = this.sortResults(searchResults, query.sortBy || 'relevance', query.sortOrder || 'desc');

      // Apply pagination
      const limit = Math.min(query.limit || this.DEFAULT_LIMIT, this.MAX_LIMIT);
      const offset = query.offset || 0;
      const paginatedResults = searchResults.slice(offset, offset + limit);

      // Calculate statistics
      const stats = this.calculateSearchStats(searchResults, Date.now() - startTime);

      // Generate search suggestions
      const suggestions = query.text ? this.generateSearchSuggestions(query.text, archives) : undefined;

      return {
        results: paginatedResults,
        stats,
        suggestions
      };

    } catch (error) {
      ArchiveErrorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        context,
        'ArchiveSearchService'
      );

      return {
        results: [],
        stats: {
          totalResults: 0,
          protectedResults: 0,
          averageRelevance: 0,
          searchTime: Date.now() - startTime,
          facets: {
            byMonth: {},
            byProtection: { protected: 0, unprotected: 0 },
            byTabCount: {}
          }
        }
      };
    }
  }

  /**
   * Get search suggestions based on archive content
   */
  static async getSearchSuggestions(
    partialQuery: string,
    maxSuggestions: number = 10
  ): Promise<string[]> {
    try {
      if (!partialQuery || partialQuery.length < 2) {
        return [];
      }

      const archiveStorage = await ArchiveStorageService.getArchives();
      const archives = Object.values(archiveStorage.archives);
      const suggestions = new Set<string>();

      const lowerQuery = partialQuery.toLowerCase();

      for (const archive of archives) {
        // Skip protected archives for suggestions
        if (archive.protection.passwordProtected) {
          continue;
        }

        const group = archive.originalGroup;
        if (typeof group === 'string') {
          continue; // Encrypted
        }

        // Check group name
        if (group.name.toLowerCase().includes(lowerQuery)) {
          suggestions.add(group.name);
        }

        // Check tab titles and URLs
        for (const tab of group.tabs) {
          if (tab.title.toLowerCase().includes(lowerQuery)) {
            suggestions.add(tab.title);
          }

          // Extract domain from URL for suggestions
          try {
            const url = new URL(tab.url);
            const domain = url.hostname.replace('www.', '');
            if (domain.includes(lowerQuery)) {
              suggestions.add(domain);
            }
          } catch {
            // Invalid URL, skip
          }
        }

        // Check tags
        if (group.tags) {
          for (const tag of group.tags) {
            if (tag.toLowerCase().includes(lowerQuery)) {
              suggestions.add(tag);
            }
          }
        }

        if (suggestions.size >= maxSuggestions) {
          break;
        }
      }

      return Array.from(suggestions).slice(0, maxSuggestions);

    } catch (error) {
      console.error('Failed to get search suggestions:', error);
      return [];
    }
  }

  /**
   * Find similar archives based on content
   */
  static async findSimilarArchives(
    referenceArchiveId: string,
    maxResults: number = 5
  ): Promise<SearchResult[]> {
    try {
      const referenceArchive = await ArchiveStorageService.getArchive(referenceArchiveId);
      if (!referenceArchive || referenceArchive.protection.passwordProtected) {
        return [];
      }

      const referenceGroup = referenceArchive.originalGroup;
      if (typeof referenceGroup === 'string') {
        return [];
      }

      const archiveStorage = await ArchiveStorageService.getArchives();
      const archives = Object.values(archiveStorage.archives)
        .filter(a => a.id !== referenceArchiveId && !a.protection.passwordProtected);

      const similarities: SearchResult[] = [];

      for (const archive of archives) {
        const group = archive.originalGroup;
        if (typeof group === 'string') {
          continue;
        }

        const similarity = this.calculateSimilarity(referenceGroup, group);
        if (similarity > 0.1) { // Minimum similarity threshold
          similarities.push({
            archive,
            relevanceScore: similarity,
            matchedFields: this.getMatchedFields(referenceGroup, group),
            highlights: []
          });
        }
      }

      return similarities
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxResults);

    } catch (error) {
      console.error('Failed to find similar archives:', error);
      return [];
    }
  }

  /**
   * Get archive analytics and insights
   */
  static async getArchiveAnalytics(): Promise<{
    totalArchives: number;
    archivesByMonth: { [month: string]: number };
    topDomains: { domain: string; count: number }[];
    archiveSizeDistribution: { [range: string]: number };
    popularTags: { tag: string; count: number }[];
    accessPatterns: { [hour: string]: number };
  }> {
    try {
      const archiveStorage = await ArchiveStorageService.getArchives();
      const archives = Object.values(archiveStorage.archives);

      const analytics = {
        totalArchives: archives.length,
        archivesByMonth: {} as { [month: string]: number },
        topDomains: [] as { domain: string; count: number }[],
        archiveSizeDistribution: {
          'small (1-10 tabs)': 0,
          'medium (11-25 tabs)': 0,
          'large (26-50 tabs)': 0,
          'very large (50+ tabs)': 0
        },
        popularTags: [] as { tag: string; count: number }[],
        accessPatterns: {} as { [hour: string]: number }
      };

      const domainCounts = new Map<string, number>();
      const tagCounts = new Map<string, number>();

      for (const archive of archives) {
        // Archive creation by month
        const date = new Date(archive.metadata.archivedDate);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        analytics.archivesByMonth[monthKey] = (analytics.archivesByMonth[monthKey] || 0) + 1;

        // Access patterns
        if (archive.metadata.lastAccessed) {
          const hour = new Date(archive.metadata.lastAccessed).getHours();
          analytics.accessPatterns[hour] = (analytics.accessPatterns[hour] || 0) + 1;
        }

        // Skip protected archives for content analysis
        if (archive.protection.passwordProtected) {
          continue;
        }

        const group = archive.originalGroup;
        if (typeof group === 'string') {
          continue;
        }

        // Size distribution
        const tabCount = group.tabs.length;
        if (tabCount <= 10) {
          analytics.archiveSizeDistribution['small (1-10 tabs)']++;
        } else if (tabCount <= 25) {
          analytics.archiveSizeDistribution['medium (11-25 tabs)']++;
        } else if (tabCount <= 50) {
          analytics.archiveSizeDistribution['large (26-50 tabs)']++;
        } else {
          analytics.archiveSizeDistribution['very large (50+ tabs)']++;
        }

        // Domain analysis
        for (const tab of group.tabs) {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname.replace('www.', '');
            domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
          } catch {
            // Invalid URL, skip
          }
        }

        // Tag analysis
        if (group.tags) {
          for (const tag of group.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }
      }

      // Convert maps to sorted arrays
      analytics.topDomains = Array.from(domainCounts.entries())
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      analytics.popularTags = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      return analytics;

    } catch (error) {
      console.error('Failed to get archive analytics:', error);
      return {
        totalArchives: 0,
        archivesByMonth: {},
        topDomains: [],
        archiveSizeDistribution: {
          'small (1-10 tabs)': 0,
          'medium (11-25 tabs)': 0,
          'large (26-50 tabs)': 0,
          'very large (50+ tabs)': 0
        },
        popularTags: [],
        accessPatterns: {}
      };
    }
  }

  // Private helper methods

  private static applyFilters(archives: ArchivedGroup[], query: SearchQuery): ArchivedGroup[] {
    return archives.filter(archive => {
      // Date range filter
      if (query.dateRange) {
        const archiveDate = archive.metadata.archivedDate;
        if (archiveDate < query.dateRange.start.getTime() || archiveDate > query.dateRange.end.getTime()) {
          return false;
        }
      }

      // Protection status filter
      if (query.protectionStatus && query.protectionStatus !== 'all') {
        const isProtected = archive.protection.passwordProtected;
        if (query.protectionStatus === 'protected' && !isProtected) return false;
        if (query.protectionStatus === 'unprotected' && isProtected) return false;
      }

      // Tab count filters
      if (archive.protection.passwordProtected) {
        return true; // Can't check tab count for protected archives
      }

      const group = archive.originalGroup;
      if (typeof group === 'string') {
        return true; // Encrypted, can't check
      }

      const tabCount = group.tabs.length;
      if (query.minTabCount && tabCount < query.minTabCount) return false;
      if (query.maxTabCount && tabCount > query.maxTabCount) return false;

      // Tag filter
      if (query.tags && query.tags.length > 0) {
        const archiveTags = group.tags || [];
        if (!query.tags.some(tag => archiveTags.includes(tag))) {
          return false;
        }
      }

      return true;
    });
  }

  private static async performTextSearch(
    archives: ArchivedGroup[],
    searchText: string,
    options: AdvancedSearchOptions
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const normalizedQuery = options.caseSensitive ? searchText : searchText.toLowerCase();

    for (const archive of archives) {
      const searchResult = this.searchInArchive(archive, normalizedQuery, options);
      if (searchResult.relevanceScore > 0) {
        results.push(searchResult);
      }
    }

    return results;
  }

  private static searchInArchive(
    archive: ArchivedGroup,
    query: string,
    options: AdvancedSearchOptions
  ): SearchResult {
    const result: SearchResult = {
      archive,
      relevanceScore: 0,
      matchedFields: [],
      highlights: []
    };

    // Skip content search for protected archives
    if (archive.protection.passwordProtected) {
      // Only search metadata
      if (this.textMatches('Protected Archive', query, options)) {
        result.relevanceScore = 0.1;
        result.matchedFields.push('name');
      }
      return result;
    }

    const group = archive.originalGroup;
    if (typeof group === 'string') {
      return result; // Encrypted
    }

    let totalScore = 0;

    // Search group name (highest weight)
    if (this.textMatches(group.name, query, options)) {
      totalScore += 3;
      result.matchedFields.push('name');
      result.highlights.push(...this.createHighlights('name', group.name, query, options));
    }

    // Search tab titles and URLs
    for (const tab of group.tabs) {
      if (this.textMatches(tab.title, query, options)) {
        totalScore += 2;
        if (!result.matchedFields.includes('tabs')) {
          result.matchedFields.push('tabs');
        }
        result.highlights.push(...this.createHighlights('tabTitle', tab.title, query, options));
      }

      if (options.includeTabContent && this.textMatches(tab.url, query, options)) {
        totalScore += 1;
        if (!result.matchedFields.includes('urls')) {
          result.matchedFields.push('urls');
        }
        result.highlights.push(...this.createHighlights('tabUrl', tab.url, query, options));
      }
    }

    // Search tags
    if (group.tags) {
      for (const tag of group.tags) {
        if (this.textMatches(tag, query, options)) {
          totalScore += 1.5;
          if (!result.matchedFields.includes('tags')) {
            result.matchedFields.push('tags');
          }
          result.highlights.push(...this.createHighlights('tag', tag, query, options));
        }
      }
    }

    // Apply relevance boosters
    if (options.boostRecent) {
      const daysSinceArchive = (Date.now() - archive.metadata.archivedDate) / (1000 * 60 * 60 * 24);
      const recencyBoost = Math.max(0, 1 - daysSinceArchive / 365); // Boost diminishes over a year
      totalScore *= (1 + recencyBoost * 0.5);
    }

    if (options.boostAccessed) {
      const accessBoost = Math.min(archive.metadata.accessCount * 0.1, 0.5);
      totalScore *= (1 + accessBoost);
    }

    result.relevanceScore = Math.min(totalScore, 10); // Cap at 10
    return result;
  }

  private static textMatches(text: string, query: string, options: AdvancedSearchOptions): boolean {
    const normalizedText = options.caseSensitive ? text : text.toLowerCase();
    const normalizedQuery = options.caseSensitive ? query : query.toLowerCase();

    if (options.regexMode) {
      try {
        const regex = new RegExp(normalizedQuery, options.caseSensitive ? 'g' : 'gi');
        return regex.test(normalizedText);
      } catch {
        return false; // Invalid regex
      }
    }

    if (options.wholeWords) {
      const regex = new RegExp(`\\b${this.escapeRegex(normalizedQuery)}\\b`, 'i');
      return regex.test(normalizedText);
    }

    if (options.fuzzyMatching) {
      return this.fuzzyMatch(normalizedText, normalizedQuery);
    }

    return normalizedText.includes(normalizedQuery);
  }

  private static createHighlights(field: string, text: string, query: string, options: AdvancedSearchOptions) {
    const highlights: SearchResult['highlights'] = [];
    const normalizedText = options.caseSensitive ? text : text.toLowerCase();
    const normalizedQuery = options.caseSensitive ? query : query.toLowerCase();

    let index = normalizedText.indexOf(normalizedQuery);
    while (index !== -1) {
      highlights.push({
        field,
        text: text.substring(Math.max(0, index - 20), Math.min(text.length, index + query.length + 20)),
        matchStart: Math.max(0, 20 - index),
        matchEnd: Math.max(0, 20 - index) + query.length
      });

      index = normalizedText.indexOf(normalizedQuery, index + 1);
      if (highlights.length >= 3) break; // Limit highlights per field
    }

    return highlights;
  }

  private static fuzzyMatch(text: string, query: string): boolean {
    // Simple fuzzy matching algorithm
    let queryIndex = 0;
    for (let i = 0; i < text.length && queryIndex < query.length; i++) {
      if (text[i] === query[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === query.length;
  }

  private static escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private static calculateRelevanceScore(
    archive: ArchivedGroup,
    query: SearchQuery,
    options: AdvancedSearchOptions
  ): number {
    let score = 1; // Base score

    // Boost recent archives
    if (options.boostRecent) {
      const daysSinceArchive = (Date.now() - archive.metadata.archivedDate) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 1 - daysSinceArchive / 365);
    }

    // Boost frequently accessed archives
    if (options.boostAccessed) {
      score += Math.min(archive.metadata.accessCount * 0.1, 1);
    }

    return score;
  }

  private static sortResults(
    results: SearchResult[],
    sortBy: string,
    sortOrder: string
  ): SearchResult[] {
    return results.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'relevance':
          comparison = a.relevanceScore - b.relevanceScore;
          break;
        case 'date':
          comparison = a.archive.metadata.archivedDate - b.archive.metadata.archivedDate;
          break;
        case 'name':
          const nameA = typeof a.archive.originalGroup === 'string' ? 'Protected' : a.archive.originalGroup.name;
          const nameB = typeof b.archive.originalGroup === 'string' ? 'Protected' : b.archive.originalGroup.name;
          comparison = nameA.localeCompare(nameB);
          break;
        case 'accessCount':
          comparison = a.archive.metadata.accessCount - b.archive.metadata.accessCount;
          break;
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }

  private static calculateSearchStats(results: SearchResult[], searchTime: number): SearchStats {
    const totalResults = results.length;
    const protectedResults = results.filter(r => r.archive.protection.passwordProtected).length;
    const averageRelevance = totalResults > 0
      ? results.reduce((sum, r) => sum + r.relevanceScore, 0) / totalResults
      : 0;

    const facets = {
      byMonth: {} as { [key: string]: number },
      byProtection: { protected: protectedResults, unprotected: totalResults - protectedResults },
      byTabCount: {
        'small (1-10)': 0,
        'medium (11-25)': 0,
        'large (26-50)': 0,
        'very large (50+)': 0
      }
    };

    for (const result of results) {
      // Month facet
      const date = new Date(result.archive.metadata.archivedDate);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      facets.byMonth[monthKey] = (facets.byMonth[monthKey] || 0) + 1;

      // Tab count facet (only for unprotected archives)
      if (!result.archive.protection.passwordProtected && typeof result.archive.originalGroup !== 'string') {
        const tabCount = result.archive.originalGroup.tabs.length;
        if (tabCount <= 10) {
          facets.byTabCount['small (1-10)']++;
        } else if (tabCount <= 25) {
          facets.byTabCount['medium (11-25)']++;
        } else if (tabCount <= 50) {
          facets.byTabCount['large (26-50)']++;
        } else {
          facets.byTabCount['very large (50+)']++;
        }
      }
    }

    return {
      totalResults,
      protectedResults,
      averageRelevance,
      searchTime,
      facets
    };
  }

  private static generateSearchSuggestions(query: string, archives: ArchivedGroup[]): string[] {
    // This would implement query expansion and spelling correction
    // For now, return simple variations
    const suggestions: string[] = [];
    const lowerQuery = query.toLowerCase();

    // Find partial matches in archive names
    for (const archive of archives.slice(0, 20)) { // Limit to first 20 for performance
      if (archive.protection.passwordProtected) continue;

      const group = archive.originalGroup;
      if (typeof group === 'string') continue;

      const words = group.name.toLowerCase().split(' ');
      for (const word of words) {
        if (word.includes(lowerQuery) && word !== lowerQuery && !suggestions.includes(word)) {
          suggestions.push(word);
        }
      }

      if (suggestions.length >= 5) break;
    }

    return suggestions;
  }

  private static calculateSimilarity(group1: any, group2: any): number {
    let similarity = 0;

    // Name similarity
    const nameWords1 = new Set(group1.name.toLowerCase().split(' '));
    const nameWords2 = new Set(group2.name.toLowerCase().split(' '));
    const nameIntersection = new Set([...nameWords1].filter(x => nameWords2.has(x)));
    const nameUnion = new Set([...nameWords1, ...nameWords2]);
    similarity += (nameIntersection.size / nameUnion.size) * 0.3;

    // Domain similarity
    const domains1 = new Set();
    const domains2 = new Set();

    for (const tab of group1.tabs) {
      try {
        domains1.add(new URL(tab.url).hostname);
      } catch {}
    }

    for (const tab of group2.tabs) {
      try {
        domains2.add(new URL(tab.url).hostname);
      } catch {}
    }

    const domainIntersection = new Set([...domains1].filter(x => domains2.has(x)));
    const domainUnion = new Set([...domains1, ...domains2]);
    if (domainUnion.size > 0) {
      similarity += (domainIntersection.size / domainUnion.size) * 0.4;
    }

    // Tag similarity
    const tags1 = new Set(group1.tags || []);
    const tags2 = new Set(group2.tags || []);
    const tagIntersection = new Set([...tags1].filter(x => tags2.has(x)));
    const tagUnion = new Set([...tags1, ...tags2]);
    if (tagUnion.size > 0) {
      similarity += (tagIntersection.size / tagUnion.size) * 0.3;
    }

    return similarity;
  }

  private static getMatchedFields(group1: any, group2: any): string[] {
    const fields: string[] = [];

    // Check name similarity
    const nameWords1 = new Set(group1.name.toLowerCase().split(' '));
    const nameWords2 = new Set(group2.name.toLowerCase().split(' '));
    if ([...nameWords1].some(word => nameWords2.has(word))) {
      fields.push('name');
    }

    // Check domain similarity
    const domains1 = new Set();
    const domains2 = new Set();

    for (const tab of group1.tabs) {
      try { domains1.add(new URL(tab.url).hostname); } catch {}
    }
    for (const tab of group2.tabs) {
      try { domains2.add(new URL(tab.url).hostname); } catch {}
    }

    if ([...domains1].some(domain => domains2.has(domain))) {
      fields.push('domains');
    }

    // Check tag similarity
    const tags1 = new Set(group1.tags || []);
    const tags2 = new Set(group2.tags || []);
    if ([...tags1].some(tag => tags2.has(tag))) {
      fields.push('tags');
    }

    return fields;
  }
}