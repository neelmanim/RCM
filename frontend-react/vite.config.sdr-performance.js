/**
 * vite.config.sdr-performance.js
 *
 * Builds the SDR Performance Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:sdr-performance
 * Output: frontend/js/sdr-performance-hub.js + frontend/js/sdr-performance-hub.css
 *
 * Mirrors vite.config.leaderboard.js exactly. Replaces the legacy
 * frontend/js/views/sdr_performance.js.
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
      entry: 'src/sdr-performance-entry.jsx',
      name: 'SdrPerformanceHub',
      formats: ['iife'],
      fileName: () => 'sdr-performance-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'sdr-performance-hub.css';
          return assetInfo.name || 'sdr-performance-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
