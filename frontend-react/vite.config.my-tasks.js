/**
 * vite.config.my-tasks.js
 *
 * Builds the My Tasks Hub as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the Vanilla JS static site picks it up
 * without a separate Render service.
 *
 * Build: npm run build:my-tasks
 * Output: frontend/js/my-tasks-hub.js + frontend/js/my-tasks-hub.css
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
      entry: 'src/my-tasks-entry.jsx',
      name: 'MyTasksHub',
      formats: ['iife'],
      fileName: () => 'my-tasks-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'my-tasks-hub.css';
          return assetInfo.name || 'my-tasks-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
