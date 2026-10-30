/**
 * @module options/components/wrapped/WrappedCard
 *
 * WHY:  The stat card is the viral sharing artifact — a 1080x1080 image that
 *       users download, copy, or share on social media. Canvas rendering keeps
 *       it self-contained and independent of DOM/CSS.
 *
 * WHAT: Off-screen canvas rendering of the Wrapped stat card, plus three export
 *       functions: generateStatCardBlob, downloadStatCard, copyStatCardToClipboard.
 *
 * HOW:  - generateStatCardBlob draws onto a 1080x1080 canvas (dark gradient bg,
 *         Bluetab icon, year text, big stats, top domains, personality title)
 *       - downloadStatCard triggers an anchor-based download
 *       - copyStatCardToClipboard uses navigator.clipboard.write + ClipboardItem
 *
 * NOT:  Does not render any React UI — pure export utility module.
 */

import { ToastManager } from '../../../components/Toast';
import type { WrappedSnapshot } from '../../../types/wrapped';
import { getLocaleTag, t as translate } from '@/i18n';

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

const CANVAS_SIZE = 1080;
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function hex(color: string): string {
  return color;
}

/**
 * Draw a rounded rectangle path on the canvas context.
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Fetch the Bluetab icon as an ImageBitmap for drawing on canvas.
 * Returns null if fetch fails (card renders without icon).
 */
async function loadIcon(): Promise<ImageBitmap | null> {
  try {
    const url = chrome.runtime.getURL('src/assets/icon128.png');
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core canvas renderer
// ---------------------------------------------------------------------------

/**
 * Render a 1080x1080 stat card PNG and return it as a Blob.
 *
 * Layout (top to bottom):
 *   - Deep dark diagonal gradient background
 *   - Bluetab icon (top-left) + "BLUETAB WRAPPED {year}" header text
 *   - Horizontal divider line
 *   - Big number stats: totalTabsSaved + totalGroupsCreated
 *   - Top 3 domains mini-list
 *   - Personality title (if present) at the bottom in accent color
 *   - Footer: bluetab.app
 */
export async function generateStatCardBlob(snapshot: WrappedSnapshot): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const S = CANVAS_SIZE;

  // ---- Background gradient (deep dark, diagonal) ---------------------------
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, hex('#0f0720'));
  bg.addColorStop(0.45, hex('#1a0533'));
  bg.addColorStop(1, hex('#0a1628'));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // Subtle accent radial glow at bottom-right
  const glow = ctx.createRadialGradient(S * 0.85, S * 0.9, 0, S * 0.85, S * 0.9, S * 0.6);
  glow.addColorStop(0, 'rgba(99, 102, 241, 0.18)');
  glow.addColorStop(1, 'rgba(99, 102, 241, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // ---- Icon ----------------------------------------------------------------
  const icon = await loadIcon();
  const iconSize = 80;
  const iconX = 60;
  const iconY = 60;

  if (icon) {
    // Draw with rounded corners via clip
    ctx.save();
    roundRect(ctx, iconX, iconY, iconSize, iconSize, 16);
    ctx.clip();
    ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);
    ctx.restore();
  } else {
    // Fallback: filled indigo square
    ctx.fillStyle = hex('#6366f1');
    roundRect(ctx, iconX, iconY, iconSize, iconSize, 16);
    ctx.fill();
  }

  // ---- Header text ---------------------------------------------------------
  const headerX = iconX + iconSize + 24;
  const headerY = iconY + 26;

  ctx.fillStyle = 'rgba(165, 180, 252, 0.85)'; // indigo-300
  ctx.font = `bold 22px ${FONT_FAMILY}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('BLUETAB WRAPPED', headerX, headerY);

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 56px ${FONT_FAMILY}`;
  ctx.letterSpacing = '0px';
  ctx.fillText(String(snapshot.year), headerX, headerY + 60);

  // ---- Divider -------------------------------------------------------------
  const divY = iconY + iconSize + 40;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(60, divY);
  ctx.lineTo(S - 60, divY);
  ctx.stroke();

  // ---- Main stat blocks ----------------------------------------------------
  const statsY = divY + 60;
  const blockW = (S - 60 * 2 - 24) / 2;
  const blockH = 220;

  // Block backgrounds (glassmorphic)
  const drawStatBlock = (x: number, num: string, label: string) => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    roundRect(ctx, x, statsY, blockW, blockH, 24);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, statsY, blockW, blockH, 24);
    ctx.stroke();

    // Big number
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 96px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(num, x + blockW / 2, statsY + 130);

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `bold 28px ${FONT_FAMILY}`;
    ctx.fillText(label, x + blockW / 2, statsY + 180);

    ctx.textAlign = 'left';
  };

  const tabsNum = snapshot.totalTabsSaved.toLocaleString(getLocaleTag());
  const groupsNum = snapshot.totalGroupsCreated.toLocaleString(getLocaleTag());
  drawStatBlock(60, tabsNum, translate('options.wrappedShare.tabsSaved'));
  drawStatBlock(60 + blockW + 24, groupsNum, translate('components.wrapped.groupsCreated'));

  // ---- Top 3 domains -------------------------------------------------------
  const domainsY = statsY + blockH + 50;
  const top3 = snapshot.topDomains.slice(0, 3);

  if (top3.length > 0) {
    ctx.fillStyle = 'rgba(165, 180, 252, 0.75)';
    ctx.font = `bold 24px ${FONT_FAMILY}`;
    ctx.letterSpacing = '2px';
    ctx.fillText(translate('options.wrappedShare.topSites').toLocaleUpperCase(getLocaleTag()), 60, domainsY);
    ctx.letterSpacing = '0px';

    const rankColors = ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.72)', 'rgba(255,255,255,0.52)'];
    const rankLabels = ['1.', '2.', '3.'];

    top3.forEach((d, i) => {
      const rowY = domainsY + 52 + i * 66;

      // Row background
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      roundRect(ctx, 60, rowY - 36, S - 120, 56, 12);
      ctx.fill();

      // Rank
      ctx.fillStyle = 'rgba(165,180,252,0.6)';
      ctx.font = `bold 22px ${FONT_FAMILY}`;
      ctx.fillText(rankLabels[i], 84, rowY + 4);

      // Domain/title name — show title if available, fall back to cleaned domain
      const displayName = d.title || d.domain.replace(/^www\./, '');
      ctx.fillStyle = rankColors[i];
      ctx.font = `bold 30px ${FONT_FAMILY}`;
      ctx.fillText(displayName, 130, rowY + 6);

      // Visit count (right-aligned)
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = `26px ${FONT_FAMILY}`;
      ctx.textAlign = 'right';
      ctx.fillText(d.visits.toLocaleString(getLocaleTag()), S - 84, rowY + 6);
      ctx.textAlign = 'left';
    });
  }

  // ---- Personality title ---------------------------------------------------
  if (snapshot.personalityTitle) {
    const titleY = S - 180;

    // Accent divider
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(60, titleY - 20);
    ctx.lineTo(S - 60, titleY - 20);
    ctx.stroke();

    ctx.fillStyle = hex('#a78bfa'); // violet-400
    ctx.font = `bold 48px ${FONT_FAMILY}`;
    ctx.fillText(snapshot.personalityTitle.title, 60, titleY + 30);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `28px ${FONT_FAMILY}`;
    // Wrap description at max ~900px
    const desc = snapshot.personalityTitle.description;
    ctx.fillText(desc, 60, titleY + 78);
  }

  // ---- Footer --------------------------------------------------------------
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = `24px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText('bluetab.app', S / 2, S - 40);
  ctx.textAlign = 'left';

  // ---- Return blob ---------------------------------------------------------
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob returned null'));
        }
      },
      'image/png',
    );
  });
}

// ---------------------------------------------------------------------------
// Export functions
// ---------------------------------------------------------------------------

/**
 * Download the stat card as a PNG file.
 * Filename: bluetab-wrapped-{year}.png
 */
export async function downloadStatCard(snapshot: WrappedSnapshot): Promise<void> {
  const blob = await generateStatCardBlob(snapshot);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `bluetab-wrapped-${snapshot.year}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Copy the stat card image to the clipboard using ClipboardItem.
 * Shows a success or error toast via ToastManager.
 */
export async function copyStatCardToClipboard(snapshot: WrappedSnapshot): Promise<void> {
  try {
    const blob = await generateStatCardBlob(snapshot);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    ToastManager.getInstance().success(translate('components.wrapped.cardCopied'));
  } catch (err) {
    console.error('[WrappedCard] copyStatCardToClipboard failed:', err);
    ToastManager.getInstance().error(translate('components.wrapped.cardCopyFailed'));
  }
}
