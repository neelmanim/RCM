/**
 * vite.config.ae-pipeline.js
 *
 * Builds the AE Pipeline Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npx vite build --config vite.config.ae-pipeline.js
 * Output: frontend/js/ae-pipeline-hub.js + frontend/js/ae-pipeline-hub.css
 *
 * Mirrors vite.config.sdr-performance.js exactly.
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
      entry: 'src/ae-pipeline-entry.jsx',
      name: 'AEPipelineHub',
      formats: ['iife'],
      fileName: () => 'ae-pipeline-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'ae-pipeline-hub.css';
          return assetInfo.name || 'ae-pipeline-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
