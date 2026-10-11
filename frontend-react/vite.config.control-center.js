/**
 * vite.config.control-center.js
 *
 * Builds the Control Center Hub as a self-contained IIFE bundle. Output
 * drops directly into frontend/js/ so the Vanilla JS static site picks it
 * up without a separate Render service.
 *
 * Build: npm run build:control-center
 * Output: frontend/js/control-center-hub.js + frontend/js/control-center-hub.css
 *
 * Mirrors vite.config.activity-monitor.js exactly.
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
      entry: 'src/control-center-entry.jsx',
      name: 'ControlCenterHub',
      formats: ['iife'],
      fileName: () => 'control-center-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'control-center-hub.css';
          return assetInfo.name || 'control-center-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
