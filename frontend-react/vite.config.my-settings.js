/**
 * vite.config.my-settings.js
 *
 * Builds the My Settings Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:my-settings
 * Output: frontend/js/my-settings-hub.js + frontend/js/my-settings-hub.css
 *
 * Mirrors vite.config.daily-digest.js exactly. Replaces the legacy
 * frontend/js/views/sdr_settings.js.
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
      entry: 'src/my-settings-entry.jsx',
      name: 'MySettingsHub',
      formats: ['iife'],
      fileName: () => 'my-settings-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'my-settings-hub.css';
          return assetInfo.name || 'my-settings-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
