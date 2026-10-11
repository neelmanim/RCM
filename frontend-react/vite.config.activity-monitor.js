/**
 * vite.config.activity-monitor.js
 *
 * Builds the Activity Monitor Hub as a self-contained IIFE bundle. Output
 * drops directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:activity-monitor
 * Output: frontend/js/activity-monitor-hub.js + frontend/js/activity-monitor-hub.css
 *
 * Mirrors vite.config.pods.js exactly.
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
      entry: 'src/activity-monitor-entry.jsx',
      name: 'ActivityMonitorHub',
      formats: ['iife'],
      fileName: () => 'activity-monitor-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'activity-monitor-hub.css';
          return assetInfo.name || 'activity-monitor-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
