/**
 * vite.config.pipeline-hub.js
 *
 * Builds the Pipeline Hub (Super-Admin merge of AE Pipeline + CSM Portal)
 * as a self-contained IIFE bundle. Output drops directly into frontend/js/
 * so the Vanilla JS static site picks it up without a separate Render
 * service.
 *
 * Build: npm run build:pipeline-hub
 * Output: frontend/js/pipeline-hub.js + frontend/js/pipeline-hub.css
 *
 * Mirrors vite.config.ae-pipeline.js / vite.config.csm-portal.js exactly.
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
      entry: 'src/pipeline-hub-entry.jsx',
      name: 'PipelineHub',
      formats: ['iife'],
      fileName: () => 'pipeline-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'pipeline-hub.css';
          return assetInfo.name || 'pipeline-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
