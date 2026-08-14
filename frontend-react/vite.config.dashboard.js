/**
 * vite.config.dashboard.js
 *
 * Builds the Dashboard React component as a self-contained IIFE bundle.
 * Output drops directly into frontend/js/ so the Vanilla JS static site
 * picks it up without a separate Render service.
 *
 * Build: npm run build:dashboard
 * Output: frontend/js/dashboard-hub.js + frontend/js/dashboard-hub.css
 *
 * Mirrors vite.config.analytics.js exactly.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    // Pre-generate dashboard-hub.js.gz at build time.
    // Render static site serves pre-compressed .gz files automatically
    // when the browser sends Accept-Encoding: gzip — reducing wire transfer
    // from ~871 KB to ~269 KB with zero server-side config required.
    compression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024,
      deleteOriginFile: false,
    }),
  ],
  // Replace process.env.NODE_ENV at bundle time — React internals reference this
  // Node.js global which does not exist in the browser IIFE context.
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: 'src/dashboard-entry.jsx',
      name: 'DashboardHub',
      formats: ['iife'],
      fileName: () => 'dashboard-hub.js',
    },
    outDir: '../frontend/js',
    // IMPORTANT: never wipe frontend/js — it contains other Vanilla JS files
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'dashboard-hub.css';
          return assetInfo.name || 'dashboard-hub-asset';
        },
      },
    },
    // Target modern browsers only
    target: 'es2020',
  },
});
