/**
 * vite.config.messenger.js
 *
 * Builds the Alternate Messenger Widget (React port of messenger_widget.js +
 * messenger_dialer.js) as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:messenger
 * Output: frontend/js/messenger-widget.js + frontend/js/messenger-widget.css
 *
 * Mirrors vite.config.calendar.js exactly. Unlike the other hubs, this
 * bundle's IIFE name ("MessengerWidgetHub") is only the internal Rollup
 * global — the entry itself constructs the real window.MessengerWidget
 * flat-method facade, gated behind the messengerWidgetReact flag.
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
      entry: 'src/messenger-widget-entry.jsx',
      name: 'MessengerWidgetHub',
      formats: ['iife'],
      fileName: () => 'messenger-widget.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'messenger-widget.css';
          return assetInfo.name || 'messenger-widget-asset';
        },
      },
    },
    target: 'es2020',
  },
});
