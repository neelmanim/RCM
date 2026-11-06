import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: {
      entry: 'src/production-shell-entry.jsx',
      name: 'ProductionShell',
      formats: ['iife'],
      fileName: () => 'production-shell.js',
      cssFileName: 'production-shell',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
  },
});
