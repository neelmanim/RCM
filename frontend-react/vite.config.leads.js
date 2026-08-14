/**
 * vite.config.leads.js
 *
 * Builds the Leads Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:leads
 * Output: frontend/js/leads-hub.js + frontend/js/leads-hub.css
 *
 * Mirrors vite.config.calendar.js exactly.
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
      entry: 'src/leads-entry.jsx',
      name: 'LeadsHub',
      formats: ['iife'],
      fileName: () => 'leads-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'leads-hub.css';
          return assetInfo.name || 'leads-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
