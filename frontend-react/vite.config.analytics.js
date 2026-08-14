import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, appendFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Vite config for building the Analytics Hub as a self-contained IIFE bundle.
 * Output drops directly into frontend/js/ so the Vanilla JS static site picks
 * it up without a separate Render service.
 *
 * Build: npm run build:analytics
 * Output: frontend/js/analytics-hub.js + frontend/js/analytics-hub.css
 */
export default defineConfig({
  plugins: [
    react(),
    // Post-build: append our handcrafted scoped CSS to the Tailwind output.
    // This runs after Vite has written analytics-hub.css so the merge is
    // always fresh and does not require a manual step.
    {
      name: 'append-scoped-css',
      closeBundle() {
        const tailwindOut = resolve(__dirname, '../frontend/js/analytics-hub.css');
        const scopedCss   = resolve(__dirname, '../frontend/css/analytics-hub.css');
        try {
          const extra = readFileSync(scopedCss, 'utf8');
          appendFileSync(tailwindOut, '\n' + extra);
          console.log('[append-scoped-css] Appended scoped CSS →', tailwindOut);
        } catch (e) {
          console.warn('[append-scoped-css] Could not append scoped CSS:', e.message);
        }
      },
    },
  ],
  // Replace process.env.NODE_ENV at bundle time — React internals reference this
  // Node.js global, which does not exist in the browser IIFE context. Without this
  // the bundle throws "process is not defined" on load.
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: 'src/analytics-entry.jsx',
      name: 'AnalyticsHub',
      formats: ['iife'],
      fileName: () => 'analytics-hub.js',
    },
    outDir: '../frontend/js',
    // IMPORTANT: never wipe frontend/js — it contains other Vanilla JS files
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'analytics-hub.css';
          return assetInfo.name || 'analytics-hub-asset';
        },
        // Inline all CSS into the JS bundle is NOT preferred for this size.
        // Keep CSS as a separate file (analytics-hub.css) for cache benefits.
      },
    },
    // Target modern browsers only (admin-only tool, no legacy support needed)
    target: 'es2020',
  },
});
