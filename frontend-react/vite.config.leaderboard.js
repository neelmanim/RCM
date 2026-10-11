/**
 * vite.config.leaderboard.js
 *
 * Builds the Leaderboard Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:leaderboard
 * Output: frontend/js/leaderboard-hub.js + frontend/js/leaderboard-hub.css
 *
 * Mirrors vite.config.daily-digest.js exactly. Replaces the legacy
 * frontend/js/views/leaderboard.js.
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
      entry: 'src/leaderboard-entry.jsx',
      name: 'LeaderboardHub',
      formats: ['iife'],
      fileName: () => 'leaderboard-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'leaderboard-hub.css';
          return assetInfo.name || 'leaderboard-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
