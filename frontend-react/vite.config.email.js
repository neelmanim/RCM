import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'fs';
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
    // Post-build: add frontend/css/email-hub.css to the built output.
    //
    // This used to appendFileSync() unconditionally. Nothing in this bundle's
    // module graph imports CSS, so vite emits no CSS asset and never
    // truncates the previous file — every build stacked another copy of those
    // 663 lines on top. Nine copies had accumulated in the committed
    // email-hub.css (5 975 lines shipped for 664 lines of actual CSS). The
    // marker makes it idempotent: cut anything we appended before, then
    // append exactly once.
    {
      name: 'append-email-scoped-css',
      closeBundle() {
        const MARKER = '/* ─── appended from frontend/css/email-hub.css ─── */';
        const builtCss  = resolve(__dirname, '../frontend/js/email-hub.css');
        const scopedCss = resolve(__dirname, '../frontend/css/email-hub.css');
        if (!existsSync(scopedCss)) return;
        try {
          const extra = readFileSync(scopedCss, 'utf8');
          let base = existsSync(builtCss) ? readFileSync(builtCss, 'utf8') : '';
          const at = base.indexOf(MARKER);
          if (at !== -1) base = base.slice(0, at);
          writeFileSync(builtCss, `${base.trimEnd()}\n${MARKER}\n${extra}`);
          console.log('[append-email-scoped-css] Appended scoped CSS →', builtCss);
        } catch (e) {
          console.warn('[append-email-scoped-css] Could not append scoped CSS:', e.message);
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
