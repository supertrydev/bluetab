import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, cpSync } from 'fs';
import { build as esbuild } from 'esbuild';
import { ENABLE_POPUP } from './src/config/feature-flags';

/**
 * Scripts injected with chrome.scripting.executeScript({ files }) run as
 * CLASSIC scripts, so they must not contain ES `import` statements. Rollup
 * splits shared code (i18n) into chunks and emits `import ... from`, which
 * made the Brain Dump modal (Alt+Q) throw a SyntaxError and never open.
 * These entries are bundled separately by esbuild as self-contained IIFEs.
 */
const INJECTED_IIFE_SCRIPTS: Array<{ entry: string; outfile: string }> = [
  { entry: 'src/content/brain-dump-modal.ts', outfile: 'dist/src/content/brain-dump-modal.js' },
];

/**
 * Store builds drop console.log/info/debug (warn and error stay). They are
 * kept in `npm run dev` (development mode) or with BLUETAB_DEBUG_LOGS=1.
 */
const DEBUG_CONSOLE_CALLS = ['console.log', 'console.info', 'console.debug'];

function debugConsoleCallsToDrop(mode: string): string[] {
  return mode === 'development' || process.env.BLUETAB_DEBUG_LOGS === '1' ? [] : DEBUG_CONSOLE_CALLS;
}

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    {
      name: 'injected-iife-scripts',
      buildStart() {
        // Not part of the Rollup graph; watch them so `npm run dev` rebuilds.
        for (const script of INJECTED_IIFE_SCRIPTS) this.addWatchFile(resolve(__dirname, script.entry));
      },
      async writeBundle() {
        await Promise.all(
          INJECTED_IIFE_SCRIPTS.map((script) =>
            esbuild({
              entryPoints: [resolve(__dirname, script.entry)],
              outfile: resolve(__dirname, script.outfile),
              bundle: true,
              format: 'iife',
              target: 'chrome120',
              minify: true,
              pure: debugConsoleCallsToDrop(mode),
              alias: { '@': resolve(__dirname, './src') },
              define: {
                'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
              },
              logLevel: 'warning',
            }),
          ),
        );
      },
    },
    {
      name: 'copy-files',
      writeBundle() {
        copyFileSync('manifest.json', 'dist/manifest.json');
        try {
          cpSync('_locales', 'dist/_locales', { recursive: true });
        } catch (error) {
          console.log('_locales folder not found or empty');
        }
        // Copy public folder contents to dist
        try {
          cpSync('public', 'dist', { recursive: true });
        } catch (error) {
          console.log('Public folder not found or empty');
        }
        // Copy extension icons to dist/src/assets
        try {
          cpSync('src/assets', 'dist/src/assets', { recursive: true });
        } catch (error) {
          console.log('Assets folder not found or empty');
        }
        // Copy scripts (theme-sync.js, theme-init.js, alpine-init.js)
        try {
          cpSync('src/scripts', 'dist/src/scripts', { recursive: true });
        } catch (error) {
          console.log('Scripts folder not found or empty');
        }
      }
    }
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        ...(ENABLE_POPUP ? { popup: resolve(__dirname, 'src/popup/index.html') } : {}),
        newtab: resolve(__dirname, 'src/newtab/index.html'),
        newtabApp: resolve(__dirname, 'src/newtab/app.html'),
        urlCleaner: resolve(__dirname, 'src/newtab/url-cleaner.js'),
        options: resolve(__dirname, 'src/options/index.html'),
        feeds: resolve(__dirname, 'src/feeds/index.html'),
        settings: resolve(__dirname, 'src/settings/index.html'),
        account: resolve(__dirname, 'src/account/index.html'),
        flow: resolve(__dirname, 'src/flow/index.html'),
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        blocked: resolve(__dirname, 'src/blocked/index.html'),
        onboarding: resolve(__dirname, 'src/onboarding/index.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        offscreen: resolve(__dirname, 'src/background/offscreen.html'),
        content: resolve(__dirname, 'src/content/content.ts'),
        floatingButton: resolve(__dirname, 'src/content/floating-button.ts'),
        // Phase 9 — Safe Auto-Suspend content script (injected on-demand
        // via chrome.scripting.executeScript right before chrome.tabs.discard).
        faviconOverlay: resolve(__dirname, 'src/content/favicon-overlay.ts'),
        // Brain Dump capture modal (Alt+Q) is NOT a Rollup input: it is
        // injected as a classic script, see INJECTED_IIFE_SCRIPTS above.
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Map entries to their correct locations
          if (chunkInfo.name === 'background') return 'src/background/service-worker.js';
          if (chunkInfo.name === 'content') return 'src/content/content.js';
          if (chunkInfo.name === 'floatingButton') return 'src/content/floating-button.js';
          if (chunkInfo.name === 'faviconOverlay') return 'src/content/favicon-overlay.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    target: 'esnext',
    minify: 'esbuild',
  },
  esbuild: {
    pure: debugConsoleCallsToDrop(mode),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
}));
