import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: '/workbench/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4318' },
  },
  build: { outDir: '../dist/client', emptyOutDir: true },
});
