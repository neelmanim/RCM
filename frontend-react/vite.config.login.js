/**
 * vite.config.login.js
 *
 * Builds the Login page as a self-contained IIFE bundle. Output drops
 * directly into frontend/js/ so the static site picks it up with no
 * separate Render build step (frontend/login.html mounts it into a single
 * #login-root div — see login-entry.jsx's doc comment for why this one
 * doesn't use the registerHub Hub contract like every other island).
 *
 * Build: npm run build:login
 * Output: frontend/js/login-hub.js + frontend/js/login-hub.css
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
      entry: 'src/login-entry.jsx',
      name: 'LoginHub',
      formats: ['iife'],
      fileName: () => 'login-hub.js',
    },
    outDir: '../frontend/js',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'login-hub.css';
          return assetInfo.name || 'login-hub-asset';
        },
      },
    },
    target: 'es2020',
  },
});
