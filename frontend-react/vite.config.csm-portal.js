/**
 * vite.config.csm-portal.js
 *
 * Builds the CSM Portal Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:csm-portal
 * Output: frontend/js/csm-portal-hub.js + frontend/js/csm-portal-hub.css
 *
 * Mirrors vite.config.sdr-performance.js exactly.
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
      entry: 'src/csm-portal-entry.jsx',
      name: 'CsmPortalHub',
      formats: ['iife'],
      fileName: () => 'csm-portal-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'csm-portal-hub.css';
          return assetInfo.name || 'csm-portal-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
