/**
 * vite.config.daily-digest.js
 *
 * Builds the Daily Digest Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:daily-digest
 * Output: frontend/js/daily-digest-hub.js + frontend/js/daily-digest-hub.css
 *
 * Mirrors vite.config.sales-tools.js exactly. Replaces the legacy
 * frontend/js/views/digest.js + frontend/css/digest.css (deleted).
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    compression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024,
      deleteOriginFile: false,
    }),
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: 'src/daily-digest-entry.jsx',
      name: 'DailyDigestHub',
      formats: ['iife'],
      fileName: () => 'daily-digest-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'daily-digest-hub.css';
          return assetInfo.name || 'daily-digest-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
