/**
 * @module settings/search-highlight
 *
 * WHY:  After a settings search the user should land on the words they typed,
 *       not only on the section that holds them.
 *
 * WHAT: Finds the visible matches, paints them yellow and scrolls to one.
 *
 * HOW:  Uses the CSS Custom Highlight API, so React's DOM is never changed.
 *       Where it is missing the jump still works, without the paint.
 */

import { findSearchMatch, matchesSearch, normalizeForSearch } from '@/utils/search-text';

export interface SearchHit {
    sectionId: string;
    element: Element;
    /** Missing when the text is a label or a placeholder, which cannot be painted. */
    range?: Range;
}

const ALL = 'settings-search';
const CURRENT = 'settings-search-current';
const LABEL_HIT = 'data-search-hit';

function isVisible(element: Element): boolean {
    return element.getClientRects().length > 0;
}

function findInTextNodes(section: Element, sectionId: string, query: string): SearchHit[] {
    const hits: SearchHit[] = [];
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue ?? '';
        const element = node.parentElement;
        if (!element || !text.trim()) continue;
        for (let match = findSearchMatch(text, query); match; match = findSearchMatch(text, query, match.end)) {
            if (!isVisible(element)) break;
            const range = document.createRange();
            range.setStart(node, match.start);
            range.setEnd(node, match.end);
            hits.push({ sectionId, element, range });
        }
    }
    return hits;
}

function findInLabels(section: Element, sectionId: string, query: string): SearchHit[] {
    return [...section.querySelectorAll('[placeholder], [aria-label], [title]')]
        .filter((element) => isVisible(element) && ['placeholder', 'aria-label', 'title']
            .some((name) => matchesSearch(element.getAttribute(name) ?? '', query)))
        .map((element) => ({ sectionId, element }));
}

/** The whole phrase first; its single words when the phrase is not written together. */
export function findSearchHits(section: Element, sectionId: string, query: string): SearchHit[] {
    const phrase = normalizeForSearch(query);
    if (!phrase) return [];
    const hits = findInTextNodes(section, sectionId, phrase);
    if (hits.length) return hits;
    const labels = findInLabels(section, sectionId, phrase);
    if (labels.length) return labels;
    const words = phrase.split(' ');
    return words.length > 1 ? words.flatMap((word) => findInTextNodes(section, sectionId, word)) : [];
}

export function clearSearchHits(): void {
    if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
        CSS.highlights.delete(ALL);
        CSS.highlights.delete(CURRENT);
    }
    document.querySelectorAll(`[${LABEL_HIT}]`).forEach((element) => element.removeAttribute(LABEL_HIT));
}

export function paintSearchHits(hits: SearchHit[], current: SearchHit | undefined): void {
    clearSearchHits();
    if (current && !current.range) current.element.setAttribute(LABEL_HIT, '');
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    const ranges = hits.flatMap((hit) => (hit.range && hit !== current ? [hit.range] : []));
    CSS.highlights.set(ALL, new Highlight(...ranges));
    if (current?.range) CSS.highlights.set(CURRENT, new Highlight(current.range));
}

/**
 * Centers a match inside the settings scroller and any list within it. Instant
 * on purpose: the page should be there by the time the user looks.
 * Text in a closed disclosure is opened first.
 * Not scrollIntoView, which would also push the page header out of sight.
 */
export function scrollToHit(hit: SearchHit, container: Element): void {
    for (let closed = hit.element.closest('details:not([open])'); closed; closed = hit.element.closest('details:not([open])')) {
        if (hit.element.closest('summary')?.parentElement === closed) break;
        closed.setAttribute('open', '');
    }
    const getRect = () => (hit.range ?? hit.element).getBoundingClientRect();
    for (let parent = hit.element.parentElement; parent; parent = parent.parentElement) {
        const scrolls = parent === container
            || (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY));
        if (scrolls) {
            const box = parent.getBoundingClientRect();
            const rect = getRect();
            parent.scrollTop += rect.top + rect.height / 2 - (box.top + box.height / 2);
        }
        if (parent === container) return;
    }
}
