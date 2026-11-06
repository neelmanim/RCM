import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: {
      entry: 'src/public-pages-entry.jsx',
      name: 'PublicPages',
      formats: ['iife'],
      fileName: () => 'public-pages.js',
      cssFileName: 'public-pages',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
  },
});
