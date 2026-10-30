/**
 * @module content/favicon-overlay
 *
 * WHY:  Phase 9 ADHD-06 — users need a visible "this tab is suspended" cue
 *       in Chrome's native tab strip. The per-tab action badge is
 *       authoritative post-discard but only shows while the tab is active.
 *       The favicon overlay is what an inactive tab renders in the strip
 *       when you glance at it — crucial for CRIT-04 (object-permanence
 *       panic) structural prevention.
 *
 * DESIGN: Composite favicon with async-aware handshake.
 * --------------------------------------------------
 *  Goal: the sidepanel's discarded-tab row uses a React-rendered composite
 *  visual (the page's original favicon plus a Zz corner badge overlaid on
 *  top). Chrome's native tab strip cannot render React, so we must produce
 *  an equivalent SINGLE composite data-URL and write it to
 *  <link rel="icon">. Chrome's tab strip reads that link on page load /
 *  post-discard and paints the composite in the strip.
 *
 *  Pipeline:
 *    1. Find the current favicon URL (<link rel~=icon>, then /favicon.ico).
 *    2. Load it into an HTMLImageElement (CORS-optimistic, non-CORS retry).
 *    3. Draw it onto a 64x64 canvas, overlay an amber Zz badge in the
 *       bottom-right quadrant.
 *    4. Export via canvas.toDataURL('image/png').
 *    5. Swap every page-provided <link rel=icon> for a single fresh
 *       <link data-bluetab-zz="1" type="image/png">.
 *    6. MutationObserver on <head> re-applies if an SPA later mutates the
 *       favicon (React SPA reset pattern — Pitfall 1 from 09-RESEARCH).
 *    7. Post a chrome.runtime.sendMessage handshake so the service worker
 *       knows the DOM mutation completed and can safely call
 *       chrome.tabs.discard without racing the composite work.
 *
 *  Fallback: if ANY step of the composite fails (favicon missing, CORS
 *  blocks canvas read, decoder error, restricted page), apply the
 *  pure-Zz SVG data URI (same as the prior single-pass implementation)
 *  and send the handshake anyway so the service worker does not stall.
 *
 *  The per-tab `chrome.action.setBadgeText('Zz')` remains the
 *  AUTHORITATIVE indicator — any page that blocks content scripts
 *  (chrome://, Chrome Web Store, new-tab page, strict CSP) still gets
 *  the badge. Favicon Zz, sidepanel Zz glyph, and toolbar Zz badge all
 *  carry the same symbol for "this tab is suspended".
 *
 * HOW:  - Idempotency via `window.__bluetabFaviconOverlayApplied`.
 *       - Top-level async IIFE so Chrome awaits the WHOLE pipeline (when
 *         injected via `func:`) OR the service worker's handshake wait
 *         bridges the gap when injected via `files:`.
 *       - MutationObserver on `<head>` (no lifetime cap) re-applies if
 *         page JS inserts a competing icon link.
 *
 * NOT:  - Does not modify the chrome.action badge — that is the SW's job.
 *       - Does not clear itself on restore — Chrome reloads the page on
 *         re-activation, naturally re-reading the page's real favicon.
 */

const BADGE_COLOR = '#f59e0b'; // amber-500 — warning-accent
const BADGE_TEXT_COLOR = '#ffffff';
const BADGE_SIZE_RATIO = 0.5; // Zz badge covers ~50% of favicon (corner)
const COMPOSITE_SIZE = 64; // render at 64x64; browsers downscale to strip

/**
 * Hardcoded pure-Zz favicon. Fallback only — used when the original
 * favicon cannot be loaded, composited, or exported.
 */
const ZZ_FALLBACK_SVG_DATA_URL: string =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>` +
      `<circle cx='16' cy='16' r='14' fill='#64748b'/>` +
      `<text x='16' y='21' font-family='sans-serif' font-size='16' ` +
      `font-weight='bold' text-anchor='middle' fill='#ffffff'>Zz</text>` +
      `</svg>`,
  );

const WINDOW_KEY = '__bluetabFaviconOverlayApplied';
const LOG_PREFIX = '[BlueTab][favicon-overlay]';
const READY_MESSAGE_TYPE = 'bluetab:favicon-overlay-ready';

(async function runFaviconOverlay(): Promise<void> {
  const w = window as unknown as Record<string, unknown>;
  if (w[WINDOW_KEY]) return;
  w[WINDOW_KEY] = true;

  try {
    const dataUrl = await buildCompositeFaviconDataUrl();
    applyFavicon(dataUrl, 'image/png');
    startMutationObserver(dataUrl, 'image/png');
    safeLog('composite applied');
  } catch (err) {
    // Graceful fallback: pure-Zz SVG — same as the prior single-pass impl.
    applyFavicon(ZZ_FALLBACK_SVG_DATA_URL, 'image/svg+xml');
    startMutationObserver(ZZ_FALLBACK_SVG_DATA_URL, 'image/svg+xml');
    safeLog('composite failed, fell back to pure Zz:', err);
  }

  // Handshake — tell the service worker the DOM mutation is done.
  // Send AFTER the link is in place so a race-free discard can proceed.
  sendReadyHandshake();
})();

async function buildCompositeFaviconDataUrl(): Promise<string> {
  const originalUrl = findCurrentFaviconUrl();
  if (!originalUrl) {
    throw new Error('no favicon on page');
  }

  const img = await loadImage(originalUrl);

  const canvas = document.createElement('canvas');
  canvas.width = COMPOSITE_SIZE;
  canvas.height = COMPOSITE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas 2d context unavailable');
  }

  // 1. Draw original favicon filling the canvas.
  ctx.drawImage(img, 0, 0, COMPOSITE_SIZE, COMPOSITE_SIZE);

  // 2. Draw Zz corner badge in the bottom-right quadrant.
  drawZzBadge(ctx, COMPOSITE_SIZE);

  // 3. Export as PNG data URL. If the image was CORS-tainted, toDataURL
  // throws a SecurityError — caught by the outer try/catch and falls
  // through to the pure-Zz fallback.
  return canvas.toDataURL('image/png');
}

function findCurrentFaviconUrl(): string | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon"], link[rel="shortcut icon"]',
    ),
  ).filter(
    // Skip any prior Bluetab-owned link — we want the ORIGINAL favicon.
    (link) => link.getAttribute('data-bluetab-zz') !== '1',
  );

  // Prefer higher-resolution icons if multiple are declared.
  candidates.sort((a, b) => {
    const sizeA = parseInt(a.getAttribute('sizes')?.split('x')[0] ?? '0', 10);
    const sizeB = parseInt(b.getAttribute('sizes')?.split('x')[0] ?? '0', 10);
    return sizeB - sizeA;
  });

  const href = candidates[0]?.href;
  if (href) return href;

  // Well-known fallback: /favicon.ico at the site root.
  try {
    return new URL('/favicon.ico', location.href).toString();
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    // Attempt CORS first — required so canvas.toDataURL does not taint.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      // Retry without CORS — many favicon hosts omit CORS headers.
      // Image still renders to canvas, but canvas.toDataURL will throw
      // SecurityError, which the outer try/catch handles via fallback.
      const retry = new Image();
      retry.onload = () => resolve(retry);
      retry.onerror = () => reject(new Error('image load failed: ' + src));
      retry.src = src;
    };
    img.src = src;
  });
}

function drawZzBadge(ctx: CanvasRenderingContext2D, canvasSize: number): void {
  const badgeSize = canvasSize * BADGE_SIZE_RATIO;
  const cx = canvasSize - badgeSize / 2;
  const cy = canvasSize - badgeSize / 2;
  const radius = badgeSize / 2;

  // Thin white ring so the amber disc has contrast against dark favicons.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Amber badge background (one pixel smaller to leave the white ring).
  ctx.fillStyle = BADGE_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
  ctx.fill();

  // "Zz" text inside the badge. system-ui hits sans on every modern OS.
  ctx.fillStyle = BADGE_TEXT_COLOR;
  ctx.font = `bold ${Math.floor(badgeSize * 0.55)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Zz', cx, cy + 1);
}

function applyFavicon(dataUrl: string, mimeType: string): void {
  // Remove all existing icon links except our own (idempotent with itself).
  const existing = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon"], link[rel~="shortcut"]',
    ),
  );
  for (const link of existing) {
    if (link.getAttribute('data-bluetab-zz') === '1') continue;
    link.remove();
  }

  // If our link is already present (re-apply from MutationObserver), leave it
  // — it already points at the composite data URL.
  const alreadyOurs = document.head.querySelector(
    'link[data-bluetab-zz="1"]',
  );
  if (alreadyOurs) return;

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = mimeType;
  link.href = dataUrl;
  link.setAttribute('data-bluetab-zz', '1');
  document.head.appendChild(link);
}

function startMutationObserver(persistentUrl: string, mimeType: string): void {
  try {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLLinkElement) {
            const rel = node.getAttribute('rel') ?? '';
            if (
              /icon/i.test(rel) &&
              node.getAttribute('data-bluetab-zz') !== '1'
            ) {
              // Page JS inserted a competing icon — re-apply our composite.
              applyFavicon(persistentUrl, mimeType);
              return;
            }
          }
        }
      }
    });
    observer.observe(document.head, { childList: true, subtree: true });
  } catch {
    // Observer setup can fail on hardened pages — the favicon was already
    // applied synchronously above, so we still provide a visible cue.
  }
}

function sendReadyHandshake(): void {
  // Non-fatal: the SW may be asleep, the extension may be unloaded, or we
  // may be in an incognito split-mode frame where sendMessage throws.
  try {
    const maybePromise = chrome.runtime.sendMessage({
      type: READY_MESSAGE_TYPE,
    });
    // sendMessage returns a Promise in MV3 when no callback is passed.
    if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === 'function') {
      (maybePromise as Promise<unknown>).catch(() => {
        /* SW may be asleep — the SW's waitForOverlayReady will time out
           and proceed with the discard. Non-fatal. */
      });
    }
  } catch {
    /* chrome.runtime may be undefined in content-script contexts where
       the extension has been unloaded between injection and apply. The
       SW's timeout covers this. */
  }
}

function safeLog(...args: unknown[]): void {
  try {
    console.debug(LOG_PREFIX, ...args);
  } catch {
    /* console may be hardened on some pages */
  }
}
