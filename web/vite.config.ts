import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config — outputs to ../dist (committed for plugin install simplicity).
// Dev server proxies /api and /healthz to the local comark server on 8888.

export default defineConfig({
  plugins: [react()],
  build: {
    // Output into ../plugin/web/dist/ so the SPA ships inside the plugin
    // subdirectory (per marketplace source: './plugin'). Source files stay
    // here at /web/src/ for development.
    outDir: '../plugin/web/dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    cssCodeSplit: false,
    // Vite's default content-hashed filenames are exactly what we want:
    // every build invalidates browser memory caches without relying on
    // Cache-Control alone (which the browser may still fall back to disk
    // cache for). The HTML is regenerated on each build with the new asset
    // names, and the server's no-store policy on .html ensures the browser
    // refetches the entry point each time.
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': 'http://127.0.0.1:8888',
      '/healthz': 'http://127.0.0.1:8888',
    },
  },
});
