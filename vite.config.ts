import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, cpSync } from 'fs';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    {
      name: 'copy-files',
      writeBundle() {
        copyFileSync('manifest.json', 'dist/manifest.json');
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
        popup: resolve(__dirname, 'src/popup/index.html'),
        newtab: resolve(__dirname, 'src/newtab/index.html'),
        newtabApp: resolve(__dirname, 'src/newtab/app.html'),
        urlCleaner: resolve(__dirname, 'src/newtab/url-cleaner.js'),
        options: resolve(__dirname, 'src/options/index.html'),
        settings: resolve(__dirname, 'src/settings/index.html'),
        account: resolve(__dirname, 'src/account/index.html'),
        flow: resolve(__dirname, 'src/flow/index.html'),
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/content.ts'),
        floatingButton: resolve(__dirname, 'src/content/floating-button.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Map entries to their correct locations
          if (chunkInfo.name === 'background') return 'src/background/service-worker.js';
          if (chunkInfo.name === 'content') return 'src/content/content.js';
          if (chunkInfo.name === 'floatingButton') return 'src/content/floating-button.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    target: 'esnext',
    minify: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});