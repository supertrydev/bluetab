import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';

export interface ExtractedArticle {
  title: string;
  byline: string | null;
  /** Sanitized HTML */
  content: string;
}

export const sanitizeArticle = (html: string): string => DOMPurify.sanitize(html);

/** Fetch an article page and keep only its text. Null when there is none to find. */
export async function extractArticle(url: string): Promise<ExtractedArticle | null> {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) return null;
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

  // Relative images and links resolve against the article, not the extension.
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  const result = new Readability(doc).parse();
  if (!result?.content) return null;
  return { title: result.title ?? '', byline: result.byline ?? null, content: sanitizeArticle(result.content) };
}

/** Minutes to read, at 220 words a minute; at least one. */
export function readingMinutes(html: string): number {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 220));
}
