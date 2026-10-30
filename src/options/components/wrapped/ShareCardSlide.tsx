/**
 * @module options/components/wrapped/ShareCardSlide
 *
 * WHY:  The share card closes the loop — users should want to send their Wrapped
 *       to friends. Canvas export (download/clipboard) and social share intent
 *       URLs make it one click from "saw it" to "shared it".
 *
 * WHAT: Slide 6 — stat card visual preview (styled div) showing year, tabs,
 *       groups, top 3 domains, and personality title. Three real export actions:
 *       PNG download, clipboard copy, and platform share buttons.
 *
 * HOW:  - Download: calls downloadStatCard(snapshot) from WrappedCard
 *       - Clipboard: calls copyStatCardToClipboard(snapshot) from WrappedCard
 *       - Share: opens intent URLs via openShareUrl (X + WhatsApp)
 *       - Each button shows Loader2 spinner while async op runs
 *       - Slide container stops click propagation (prevents slide advance)
 *
 * NOT:  Card preview div is a styled div, NOT canvas — canvas is only used for
 *       the exported PNG. Slate charcoal to indigo gradient.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, Copy, X, MessageCircle, Loader2 } from 'lucide-react';
import type { WrappedSnapshot } from '../../../types/wrapped';
import { downloadStatCard, copyStatCardToClipboard, generateStatCardBlob } from './WrappedCard';
import { openShareUrl } from '../../../utils/social-share';
import { ToastManager } from '../../../components/Toast';
import { useTranslation } from 'react-i18next';
import { getLocaleTag } from '@/i18n';

interface ShareCardSlideProps {
  snapshot: WrappedSnapshot;
}

type LoadingKey = 'png' | 'clipboard' | 'x' | 'whatsapp';

function buildWrappedShareText(snapshot: WrappedSnapshot): string {
  const sharePrefix = snapshot.totalTabsSaved.toLocaleString(getLocaleTag());
  const personalityPart = snapshot.personalityTitle
    ? ` I am a ${snapshot.personalityTitle.title}.`
    : '';
  return `My Bluetab Wrapped ${snapshot.year}: ${sharePrefix} tabs saved!${personalityPart} #BluetabWrapped`;
}

export function ShareCardSlide({ snapshot }: ShareCardSlideProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<LoadingKey | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const top3Domains = snapshot.topDomains.slice(0, 3);

  useEffect(() => {
    try {
      setIconUrl(chrome.runtime.getURL('src/assets/icon128.png'));
    } catch { /* not in extension context */ }
  }, []);

  const run = async (key: LoadingKey, fn: () => Promise<void>) => {
    if (loading) return;
    setLoading(key);
    try {
      await fn();
    } finally {
      setLoading(null);
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    run('png', () => downloadStatCard(snapshot));
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    run('clipboard', () => copyStatCardToClipboard(snapshot));
  };

  const handleX = (e: React.MouseEvent) => {
    e.stopPropagation();
    run('x', async () => {
      // Copy image to clipboard so user can paste it in their post
      try {
        const blob = await generateStatCardBlob(snapshot);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } catch { /* clipboard write may fail in some contexts */ }
      await openShareUrl('x', buildWrappedShareText(snapshot));
      ToastManager.getInstance().info(t('options.wrappedShare.copiedForPost'));
    });
  };

  const handleWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    run('whatsapp', async () => {
      // Copy image to clipboard so user can paste it in their message
      try {
        const blob = await generateStatCardBlob(snapshot);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } catch { /* clipboard write may fail in some contexts */ }
      await openShareUrl('whatsapp', buildWrappedShareText(snapshot));
      ToastManager.getInstance().info(t('options.wrappedShare.copiedForMessage'));
    });
  };

  const spinner = <Loader2 className="w-4 h-4 animate-spin" />;

  return (
    <div
      className="flex flex-col items-center justify-center h-full text-white select-none px-6"
      style={{
        background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #6366f1 100%)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <motion.h2
        className="text-2xl font-black tracking-tight text-white mb-6"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        {t('options.wrappedShare.title')}
      </motion.h2>

      {/* Card preview (styled div -- canvas export runs off-screen) */}
      <motion.div
        className="w-full max-w-xs rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)',
        }}
        initial={{ opacity: 0, scale: 0.85, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="p-6 flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {iconUrl && (
                <img src={iconUrl} alt="Bluetab" className="w-8 h-8 rounded-lg" />
              )}
              <div>
                <span className="text-xs font-bold tracking-widest text-indigo-300 uppercase">
                  Bluetab Wrapped
                </span>
                <div dir="ltr" className="text-3xl font-black text-white leading-none mt-0.5">
                  {snapshot.year}
                </div>
              </div>
            </div>
            {snapshot.personalityTitle && (
              <div className="text-end">
                <span className="text-xs text-indigo-300 font-medium leading-tight block max-w-[100px]">
                  <bdi dir="auto">{snapshot.personalityTitle.title}</bdi>
                </span>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="flex gap-4">
            <div className="flex-1 bg-white/10 rounded-xl p-3 text-center">
              <div dir="ltr" className="text-2xl font-black text-white tabular-nums">
                {snapshot.totalTabsSaved.toLocaleString(getLocaleTag())}
              </div>
              <div className="text-xs text-white/60 tracking-wide mt-0.5">{t('options.wrappedShare.tabsSaved')}</div>
            </div>
            <div className="flex-1 bg-white/10 rounded-xl p-3 text-center">
              <div dir="ltr" className="text-2xl font-black text-white tabular-nums">
                {snapshot.totalGroupsCreated.toLocaleString(getLocaleTag())}
              </div>
              <div className="text-xs text-white/60 tracking-wide mt-0.5">{t('options.wrappedShare.groups')}</div>
            </div>
          </div>

          {/* Top domains */}
          {top3Domains.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold tracking-widest text-indigo-300 uppercase">
                {t('options.wrappedShare.topSites')}
              </span>
              {top3Domains.map((d, i) => (
                <div key={d.domain} className="flex items-center justify-between">
                  <span className="text-xs text-white/70 font-medium">
                    <span dir="ltr">{i + 1}.</span> <bdi dir={d.title ? 'auto' : 'ltr'}>{d.title || d.domain.replace(/^www\./, '')}</bdi>
                  </span>
                  <span dir="ltr" className="text-xs text-white/40 tabular-nums">
                    {d.visits.toLocaleString(getLocaleTag())}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div dir="ltr" className="text-xs text-white/30 text-center tracking-wide pt-1">
            bluetab.app
          </div>
        </div>
      </motion.div>

      {/* Export buttons */}
      <motion.div
        className="flex flex-col gap-3 mt-6 w-full max-w-xs"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        {/* Download PNG */}
        <button
          onClick={handleDownload}
          disabled={loading !== null}
          className="flex items-center justify-center gap-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {loading === 'png' ? spinner : <Download className="w-4 h-4" />}
          {t('options.wrappedShare.saveAsPng')}
        </button>

        {/* Copy to clipboard */}
        <button
          onClick={handleCopy}
          disabled={loading !== null}
          className="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {loading === 'clipboard' ? spinner : <Copy className="w-4 h-4" />}
          {t('options.wrappedShare.copyToClipboard')}
        </button>

        {/* Social share row */}
        <div className="flex gap-3">
          {/* X */}
          <button
            onClick={handleX}
            disabled={loading !== null}
            className="flex flex-1 items-center justify-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading === 'x' ? spinner : <X className="w-4 h-4" />}
            X
          </button>

          {/* WhatsApp */}
          <button
            onClick={handleWhatsApp}
            disabled={loading !== null}
            className="flex flex-1 items-center justify-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading === 'whatsapp' ? spinner : <MessageCircle className="w-4 h-4" />}
            WhatsApp
          </button>
        </div>

        {/* LinkedIn — disabled, coming soon */}
        <button
          disabled
          title={t('options.wrappedShare.linkedinTitle')}
          className="flex items-center justify-center gap-2 w-full bg-white/5 text-white/30 font-semibold py-2.5 rounded-xl cursor-not-allowed text-sm"
        >
          {t('options.wrappedShare.linkedin')}
        </button>
      </motion.div>
    </div>
  );
}
