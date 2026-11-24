/**
 * @module settings/html-export
 *
 * WHY:  "Export HTML" gives the user a page they can keep, print or send.
 *
 * WHAT: Builds one self-contained HTML document in the same visual language as
 *       the app: the same surfaces, text tones, radii, project labels and tags.
 *
 * HOW:  Plain string building. Every value from the user is escaped, and links
 *       and icons are limited to safe URL schemes.
 *
 * NOT:  No logo, scripts, web fonts or other external libraries.
 */

import { projectTintVars } from '@/config/project-tints';
import type { Project, TabGroup, Tag } from '@/types/models';

export interface HtmlExportLabels {
  title: string;
  groups: string;
  totalTabs: string;
  emptyGroup: string;
  untitled: string;
  exportedFrom: string;
}

export interface HtmlExportInput {
  groups: TabGroup[];
  tags: Tag[];
  projects: Project[];
  theme: 'light' | 'dark';
  locale: string;
  direction: 'ltr' | 'rtl';
  labels: HtmlExportLabels;
  /** Long date under the title. */
  dateLabel: string;
  /** Date and time in the footer. */
  exportedAt: string;
  tabsCount: (count: number) => string;
  formatDate: (timestamp: number) => string;
  formatNumber: (value: number) => string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeExportUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSafeFaviconUrl(url: string | undefined): url is string {
  if (!url) return false;
  return /^data:image\/(?:png|gif|jpeg|jpg|webp);/i.test(url) || isSafeExportUrl(url);
}

/** Tag colours come from stored data; anything that is not a plain hex colour falls back to grey. */
function safeColor(color: string | undefined): string {
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#6b7280';
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const STYLES = `
:root {
  color-scheme: light;
  --bg: hsl(220 20% 97%); --card: #fff; --strong: hsl(222 22% 12%); --muted: hsl(220 10% 36%);
  --border: hsl(220 14% 88%); --fill: hsl(220 30% 20% / .06); --link: hsl(226 68% 46%);
  --shadow: 0 2px 8px hsl(220 20% 50% / .08), 0 1px 3px hsl(220 20% 50% / .06);
}
.dark {
  color-scheme: dark;
  --bg: hsl(222 16% 7%); --card: hsl(222 14% 10.5%); --strong: hsl(220 14% 92%); --muted: hsl(220 9% 66%);
  --border: hsl(220 11% 20%); --fill: hsl(220 40% 90% / .08); --link: hsl(226 82% 74%);
  --shadow: 0 2px 8px hsl(220 40% 10% / .2), 0 1px 3px hsl(220 40% 10% / .1);
}
* { box-sizing: border-box; margin: 0; }
body { background: var(--bg); color: var(--strong); font: 400 1rem/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; overflow-wrap: anywhere; }
.page { max-width: 70rem; margin: 0 auto; padding: 3rem 1.5rem; }
h1 { font-size: 1.875rem; line-height: 1.2; font-weight: 600; letter-spacing: -.012em; text-wrap: balance; }
.date { margin-top: .25rem; color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: 2rem; margin: 1.5rem 0 2.5rem; }
.stats div { display: flex; flex-direction: column-reverse; }
.stats dt { color: var(--muted); font-size: .875rem; }
.stats dd { font-size: 1.5rem; line-height: 1.3; font-weight: 600; font-variant-numeric: tabular-nums; }
.groups { columns: 22rem; column-gap: 1.25rem; }
.group { position: relative; break-inside: avoid; margin-bottom: 1.5rem; border: 1px solid var(--border); border-radius: 1.25rem; background: var(--card); box-shadow: var(--shadow); }
.project { position: absolute; inset-block-start: -.625rem; inset-inline-start: -.5rem; max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); padding: .125rem .625rem; font-size: .75rem; line-height: 1.5; font-weight: 500; }
.group header { padding: 1rem 1.125rem; }
h2 { font-size: 1rem; font-weight: 600; letter-spacing: -.012em; }
.meta { display: flex; flex-wrap: wrap; gap: 0 1rem; color: var(--muted); font-size: .75rem; }
.tags { display: flex; flex-wrap: wrap; gap: .375rem; margin-top: .625rem; }
.tag { border-radius: 999px; padding: .1875rem .625rem; font-size: .75rem; line-height: 1.5; font-weight: 500; }
.note { margin-top: .625rem; color: var(--muted); font-size: .875rem; white-space: pre-wrap; }
.tabs { list-style: none; padding: .5rem; border-block-start: 1px solid var(--border); }
.tab { display: flex; align-items: center; gap: .75rem; border-radius: .625rem; padding: .5rem .625rem; color: inherit; text-decoration: none; }
a.tab:hover { background: var(--fill); }
a.tab:hover .name { color: var(--link); }
a.tab:focus-visible { outline: 2px solid var(--link); outline-offset: -2px; }
.icon { flex: none; width: 1.25rem; height: 1.25rem; border-radius: .375rem; background: var(--fill); object-fit: cover; color: var(--muted); font-size: .75rem; font-weight: 500; line-height: 1.25rem; text-align: center; }
.text { min-width: 0; }
.name, .url { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name { font-size: .875rem; font-weight: 500; }
.url { color: var(--muted); font-size: .75rem; }
.empty { padding: 1rem 1.125rem; border-block-start: 1px solid var(--border); color: var(--muted); font-size: .875rem; }
footer { margin-top: 1.5rem; color: var(--muted); font-size: .75rem; }
/* Cards of a project: same values as the app. */
.tint { --chip: var(--card); --border: var(--tint-light-border); --muted: hsl(222 16% 26%); background: color-mix(in srgb, var(--tint-light-bg) 50%, var(--card)); }
.tint .project { color: var(--tint-light-text); }
.dark .tint { --border: var(--tint-dark-border); --strong: hsl(220 14% 96%); --muted: hsl(220 16% 82%); --link: hsl(226 100% 88%); background: color-mix(in srgb, var(--tint-dark-bg) 50%, var(--card)); color: var(--strong); }
.dark .tint .project { color: var(--tint-dark-text); }
@media print {
  .dark .tint { --border: var(--tint-light-border); --strong: #111; --muted: #333; background: color-mix(in srgb, var(--tint-light-bg) 50%, var(--card)); }
  .dark .tint .project { color: var(--tint-light-text); }
  :root, .dark { color-scheme: light; --bg: #fff; --card: #fff; --strong: #111; --muted: #444; --border: #ccc; --fill: #f2f2f2; --link: #111; --shadow: none; }
  .page { padding: 0; }
  .name, .url { white-space: normal; }
}`;

function renderTab(tab: TabGroup['tabs'][number], labels: HtmlExportLabels): string {
  const icon = isSafeFaviconUrl(tab.favicon)
    ? `<img class="icon" src="${escapeHtml(tab.favicon)}" alt="" width="20" height="20" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="icon" aria-hidden="true">${escapeHtml([...hostname(tab.url ?? '')][0]?.toLocaleUpperCase() ?? '')}</span>`;
  const text = `${icon}<span class="text"><bdi class="name" dir="auto">${escapeHtml(tab.title || labels.untitled)}</bdi><bdi class="url" dir="ltr">${escapeHtml(isSafeExportUrl(tab.url) ? hostname(tab.url) : tab.url || '')}</bdi></span>`;
  return isSafeExportUrl(tab.url)
    ? `<li><a class="tab" href="${escapeHtml(tab.url)}" title="${escapeHtml(tab.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${text}</a></li>`
    : `<li><span class="tab">${text}</span></li>`;
}

function renderGroup(group: TabGroup, input: HtmlExportInput): string {
  const { labels } = input;
  const project = input.projects.find((item) => item.id === group.projectId);
  const tint = project
    ? Object.entries(projectTintVars(project.color)).map(([name, value]) => `${name}:${value}`).join(';')
    : '';
  const tags = (group.tags ?? []).flatMap((id) => input.tags.find((tag) => tag.id === id) ?? []);
  return `<article class="group${tint ? ' tint' : ''}"${tint ? ` style="${tint}"` : ''}>
${project ? `<span class="project"><bdi dir="auto">${escapeHtml(project.name)}</bdi></span>` : ''}
<header>
<h2><bdi dir="auto">${escapeHtml(group.name)}</bdi></h2>
<p class="meta"><span>${escapeHtml(input.tabsCount(group.tabs.length))}</span><time datetime="${new Date(group.created).toISOString()}">${escapeHtml(input.formatDate(group.created))}</time></p>
${tags.length ? `<div class="tags">${tags.map((tag) => `<span class="tag" style="background:color-mix(in srgb, ${safeColor(tag.color)} 25%, var(--chip, transparent))"><bdi dir="auto">${escapeHtml(tag.name)}</bdi></span>`).join('')}</div>` : ''}
${group.notes ? `<p class="note" dir="auto">${escapeHtml(group.notes)}</p>` : ''}
</header>
${group.tabs.length ? `<ul class="tabs">${group.tabs.map((tab) => renderTab(tab, labels)).join('\n')}</ul>` : `<p class="empty">${escapeHtml(labels.emptyGroup)}</p>`}
</article>`;
}

export function buildHtmlExport(input: HtmlExportInput): string {
  const { labels } = input;
  const totalTabs = input.groups.reduce((sum, group) => sum + group.tabs.length, 0);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(input.locale)}" dir="${input.direction}" class="${input.theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(`${labels.title} (${input.dateLabel})`)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">
<h1>${escapeHtml(labels.title)}</h1>
<p class="date">${escapeHtml(input.dateLabel)}</p>
<dl class="stats">
<div><dt>${escapeHtml(labels.groups)}</dt><dd>${escapeHtml(input.formatNumber(input.groups.length))}</dd></div>
<div><dt>${escapeHtml(labels.totalTabs)}</dt><dd>${escapeHtml(input.formatNumber(totalTabs))}</dd></div>
</dl>
<main class="groups">
${input.groups.map((group) => renderGroup(group, input)).join('\n')}
</main>
<footer>${escapeHtml(labels.exportedFrom)}, ${escapeHtml(input.exportedAt)}</footer>
</div>
</body>
</html>`;
}
