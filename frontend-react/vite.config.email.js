import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Vite config for building the Email Hub as a self-contained IIFE bundle.
 * Mirrors vite.config.analytics.js — output drops into frontend/js/ so the
 * Vanilla JS static site picks it up without a separate Render service.
 *
 * Build: npm run build:email
 * Output: frontend/js/email-hub.js + frontend/js/email-hub.css
 */
export default defineConfig({
  plugins: [
    react(),
    // Post-build: append scoped CSS to the built output
    {
      name: 'append-email-scoped-css',
      closeBundle() {
        const builtCss  = resolve(__dirname, '../frontend/js/email-hub.css');
        const scopedCss = resolve(__dirname, '../frontend/css/email-hub.css');
        if (existsSync(scopedCss)) {
          try {
            const extra = readFileSync(scopedCss, 'utf8');
            appendFileSync(builtCss, '\n' + extra);
            console.log('[append-email-scoped-css] Appended scoped CSS →', builtCss);
          } catch (e) {
            console.warn('[append-email-scoped-css] Could not append scoped CSS:', e.message);
          }
        }
      },
    },
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: 'src/email-entry.jsx',
      name: 'EmailHub',
      formats: ['iife'],
      fileName: () => 'email-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'email-hub.css';
          return assetInfo.name || 'email-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
