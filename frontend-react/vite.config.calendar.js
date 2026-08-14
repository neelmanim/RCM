/**
 * vite.config.calendar.js
 *
 * Builds the Calendar Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:calendar
 * Output: frontend/js/calendar-hub.js + frontend/js/calendar-hub.css
 *
 * Mirrors vite.config.dashboard.js exactly.
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
      entry: 'src/calendar-entry.jsx',
      name: 'CalendarHub',
      formats: ['iife'],
      fileName: () => 'calendar-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'calendar-hub.css';
          return assetInfo.name || 'calendar-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
