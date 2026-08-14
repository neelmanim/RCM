/**
 * vite.config.help.js
 *
 * Builds the HelpHub (Help & User Guide) React component as a self-contained
 * IIFE bundle. Output drops directly into frontend/js/ so the Vanilla JS
 * static site picks it up without a separate Render service.
 *
 * Build: npm run build:help
 * Output: frontend/js/help-hub.js + frontend/js/help-hub.css
 *
 * Mirrors vite.config.nav.js exactly.
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
      entry: 'src/help-entry.jsx',
      name: 'HelpHub',
      formats: ['iife'],
      fileName: () => 'help-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'help-hub.css';
          return assetInfo.name || 'help-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
