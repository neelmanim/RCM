/**
 * vite.config.nav.js
 *
 * Builds the NavHub (Sidebar + Topbar) React components as a self-contained
 * IIFE bundle. Output drops directly into frontend/js/ so the Vanilla JS
 * static site picks it up without a separate Render service.
 *
 * Build: npm run build:nav
 * Output: frontend/js/nav-hub.js + frontend/js/nav-hub.css
 *
 * Mirrors vite.config.dashboard.js exactly.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    // Pre-generate nav-hub.js.gz at build time.
    // Render static site serves pre-compressed .gz files automatically
    // when the browser sends Accept-Encoding: gzip — reducing wire transfer
    // with zero server-side config required.
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
      entry: 'src/nav-entry.jsx',
      name: 'NavHub',
      formats: ['iife'],
      fileName: () => 'nav-hub.js',
    },
    outDir: '../frontend/js',
    // IMPORTANT: never wipe frontend/js — it contains other Vanilla JS files
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'nav-hub.css';
          return assetInfo.name || 'nav-hub-asset';
        },
      },
    },
    // Target modern browsers only
    target: 'es2020',
  },
});
