import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: '/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/analysis': 'http://127.0.0.1:4319',
      '/api/chat': 'http://127.0.0.1:4320',
    },
  },
  build: { outDir: '../dist/client', emptyOutDir: true },
});
