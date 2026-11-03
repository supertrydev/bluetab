/**
 * @module background/offscreen-handlers
 *
 * WHY:  Service workers cannot use Audio elements OR DOMParser. An offscreen
 *       document is needed to play sounds and to perform article extraction
 *       (fetch + DOMParser + Readability + hero image waterfall) in a Chrome
 *       MV3 extension.
 *
 * WHAT: Handles two message types:
 *       - PLAY_NOTIFICATION_DING — plays a notification sound (existing path)
 *       - EXTRACT_OFFLINE_ARTICLE — fetches a URL, extracts article content
 *         via Readability, picks a hero image, returns OfflineExtractionResult
 *
 * HOW:  Uses HTMLAudioElement for audio. Uses fetch + DOMParser + Readability
 *       for extraction. DOMPurify sanitizes extracted HTML before returning.
 *       Hero image is selected via the OFFL-04 waterfall.
 */

import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import type { OfflineExtractionResult } from '@/types/offline-reading';

/**
 * Lifecycle serialization note:
 *
 * Chrome supports ONE offscreen document per extension. The audio path uses
 * reason AUDIO_PLAYBACK (30s idle timeout). The extraction path needs
 * DOM_PARSER (no timeout). The service worker (not this file) owns the
 * close/reopen lifecycle when switching between audio and extraction.
 * If both reasons coexist, the AUDIO_PLAYBACK timeout still fires during
 * long batches — serialize, don't combine.
 */

/**
 * Run one offscreen-style request in the current document. Chrome calls it
 * from the offscreen document; Firefox calls it from the background event
 * page or an extension page, which already have DOM access.
 * Returns undefined for messages this module does not handle.
 */
export function handleOffscreenMessage(message: unknown): Promise<unknown> | undefined {
  const msg = message as { type?: string; sound?: string; url?: string; html?: string } | null;
  if (msg?.type === 'PLAY_NOTIFICATION_DING') {
    playSound(msg.sound || 'ping');
    return Promise.resolve(undefined);
  }
  if (msg?.type === 'EXTRACT_OFFLINE_ARTICLE') {
    return extractArticle(msg.url as string, msg.html as string | undefined).catch(
      (err: unknown) =>
        ({
          success: false,
          failureBucket: 'network_error',
          error: String(err),
        }) as OfflineExtractionResult,
    );
  }
  return undefined;
}

export function playSound(name: string): void {
  const url = chrome.runtime.getURL(`src/assets/sounds/${name}.mp3`);
  const audio = new Audio(url);
  audio.volume = 0.5;
  audio.play().catch((err) => {
    console.error('[BlueTab][Offscreen] Failed to play sound:', err);
  });
}

// ---------------------------------------------------------------------------
// Article extraction
// ---------------------------------------------------------------------------

/**
 * Extract an article from a URL (or pre-fetched HTML string).
 *
 * When htmlOverride is provided (Wave 2 background-tab fallback sends it),
 * the fetch step is skipped — the rendered HTML is parsed directly. This
 * lets the offscreen doc act as the Readability+DOMPurify engine for both
 * the fetch path and the scripting.executeScript path.
 *
 * Content gate: textContent < 500 chars OR word count < 200 → limited_content.
 */
export async function extractArticle(
  url: string,
  htmlOverride?: string,
): Promise<OfflineExtractionResult> {
  let html: string;

  if (htmlOverride !== undefined) {
    html = htmlOverride;
  } else {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    } catch (err) {
      return {
        success: false,
        failureBucket: 'network_error',
        error: String(err),
      };
    }
    if (!response.ok) {
      return {
        success: false,
        failureBucket: 'network_error',
        error: `HTTP ${response.status}`,
      };
    }
    html = await response.text();
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Set base href so relative URLs (hero images, links) resolve correctly.
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  // Clone before Readability mutates the document in-place.
  const cloned = doc.cloneNode(true) as Document;
  const result = new Readability(cloned).parse();

  if (result === null) {
    return { success: false, failureBucket: 'no_article_structure' };
  }

  const textContent = result.textContent ?? '';
  const contentLength = textContent.length;
  const wordCount = textContent.trim().split(/\s+/).filter(Boolean).length;

  if (contentLength < 500 || wordCount < 200) {
    return {
      success: false,
      failureBucket: 'limited_content',
      contentLength,
      wordCount,
    };
  }

  const heroBlob = await pickHeroImage(doc, url);

  return {
    success: true,
    title: result.title ?? '',
    byline: result.byline ?? null,
    contentHtml: DOMPurify.sanitize(result.content ?? ''),
    contentText: textContent,
    contentLength,
    wordCount,
    heroBlob,
  };
}

// ---------------------------------------------------------------------------
// Hero image waterfall (OFFL-04)
// ---------------------------------------------------------------------------

/**
 * Select the best hero image for an article using the OFFL-04 priority waterfall:
 *   1. og:image meta tag
 *   2. Schema.org Article.image in JSON-LD blocks
 *   3. twitter:image meta tag
 *   4. First <img> element with a width attribute >= 300px
 *
 * For each candidate URL, first tries CORS mode (5s timeout), falls back to
 * no-cors. Accepts responses where resp.ok OR resp.type === 'opaque' (no-cors
 * responses can't be read but the blob still has non-zero size in practice).
 * Returns null if no qualifying image is found or all fetches fail.
 */
async function pickHeroImage(doc: Document, pageUrl: string): Promise<Blob | null> {
  const candidates: string[] = [];

  // 1. og:image
  const ogImg = doc
    .querySelector('meta[property="og:image"]')
    ?.getAttribute('content');
  if (ogImg) candidates.push(resolveUrl(ogImg, pageUrl));

  // 2. Schema.org Article.image via JSON-LD
  const jsonLdBlocks = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const block of jsonLdBlocks) {
    try {
      const schema: unknown = JSON.parse(block.textContent ?? '');
      const imgs = extractSchemaImages(schema);
      candidates.push(...imgs.map((i) => resolveUrl(i, pageUrl)));
    } catch {
      // Malformed JSON-LD — skip silently
    }
  }

  // 3. twitter:image
  const twitterImg = doc
    .querySelector('meta[name="twitter:image"]')
    ?.getAttribute('content');
  if (twitterImg) candidates.push(resolveUrl(twitterImg, pageUrl));

  // 4. First <img> with explicit width >= 300px
  const imgs = doc.querySelectorAll('img[width]');
  for (const img of imgs) {
    const w = parseInt(img.getAttribute('width') ?? '0', 10);
    if (w >= 300) {
      const src = img.getAttribute('src');
      if (src) {
        candidates.push(resolveUrl(src, pageUrl));
        break;
      }
    }
  }

  // Try each candidate in priority order; move on after any error.
  for (const candidateUrl of candidates) {
    try {
      let resp = await fetch(candidateUrl, {
        mode: 'cors',
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) {
        resp = await fetch(candidateUrl, {
          mode: 'no-cors',
          signal: AbortSignal.timeout(5_000),
        });
      }
      if (resp.ok || resp.type === 'opaque') {
        const blob = await resp.blob();
        if (blob.size > 0) return blob;
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Schema.org JSON-LD image extractor
// ---------------------------------------------------------------------------

/**
 * Recursively extract image URL strings from a Schema.org JSON-LD object.
 * Handles: string, {url: string}, [{url: string}], and nested @graph arrays.
 */
function extractSchemaImages(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  const imgs: string[] = [];
  const imageField = s['image'];
  if (typeof imageField === 'string') {
    imgs.push(imageField);
  } else if (imageField && typeof imageField === 'object' && !Array.isArray(imageField)) {
    const imgObj = imageField as Record<string, unknown>;
    if (typeof imgObj['url'] === 'string') imgs.push(imgObj['url']);
  } else if (Array.isArray(imageField)) {
    for (const item of imageField) {
      imgs.push(...extractSchemaImages(item));
    }
  }
  return imgs;
}

// ---------------------------------------------------------------------------
// URL resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a possibly-relative URL against a base URL.
 * Returns the input unchanged if URL construction fails (malformed input).
 */
function resolveUrl(maybeRelative: string, base: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}
