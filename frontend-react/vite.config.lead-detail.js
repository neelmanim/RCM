/**
 * vite.config.lead-detail.js
 *
 * Builds the Lead Detail Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:lead-detail
 * Output: frontend/js/lead-detail-hub.js + frontend/js/lead-detail-hub.css
 *
 * Mirrors vite.config.leads.js exactly.
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
      entry: 'src/lead-detail-entry.jsx',
      name: 'LeadDetailHub',
      formats: ['iife'],
      fileName: () => 'lead-detail-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'lead-detail-hub.css';
          return assetInfo.name || 'lead-detail-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
