/**
 * vite.config.sales-tools.js
 *
 * Builds the Sales Tools Hub (Cadence + Campaigns) as a self-contained IIFE
 * bundle. Output drops directly into frontend/js/ so the Vanilla JS static
 * site picks it up without a separate Render service.
 *
 * Build: npm run build:sales-tools
 * Output: frontend/js/sales-tools-hub.js + frontend/js/sales-tools-hub.css
 *
 * Mirrors vite.config.control-center.js exactly. Supersedes
 * vite.config.sales-journey.js — Sales Journey/Cadence is now embedded
 * inside this bundle (frontend-react/src/features/sales-tools/SalesToolsHub.jsx)
 * rather than mounted as its own top-level entry.
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
      entry: 'src/sales-tools-entry.jsx',
      name: 'SalesToolsHub',
      formats: ['iife'],
      fileName: () => 'sales-tools-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'sales-tools-hub.css';
          return assetInfo.name || 'sales-tools-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
