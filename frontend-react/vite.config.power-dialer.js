/**
 * vite.config.power-dialer.js
 *
 * Builds the Power Dialer Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:power-dialer
 * Output: frontend/js/power-dialer-hub.js + frontend/js/power-dialer-hub.css
 *
 * Mirrors vite.config.calendar.js / vite.config.leads.js exactly.
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
      entry: 'src/power-dialer-entry.jsx',
      name: 'PowerDialerHub',
      formats: ['iife'],
      fileName: () => 'power-dialer-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'power-dialer-hub.css';
          return assetInfo.name || 'power-dialer-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
