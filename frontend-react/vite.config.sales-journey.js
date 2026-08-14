/**
 * vite.config.sales-journey.js
 *
 * Builds the Sales Journey visual builder as a self-contained IIFE bundle.
 * Output drops directly into frontend/js/ so the Vanilla JS static site
 * picks it up without a separate Render service.
 *
 * Build: npm run build:sales-journey
 * Output: frontend/js/sales-journey-hub.js + frontend/js/sales-journey-hub.css
 *
 * Mirrors vite.config.help.js exactly.
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
      entry: 'src/sales-journey-entry.jsx',
      name: 'SalesJourneyHub',
      formats: ['iife'],
      fileName: () => 'sales-journey-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'sales-journey-hub.css';
          return assetInfo.name || 'sales-journey-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
