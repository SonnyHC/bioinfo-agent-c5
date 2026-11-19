import { defineConfig } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dna } from 'lucide-react';
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const favicon = renderToStaticMarkup(
  createElement(Dna, { color: '#20304b' },
    createElement('style', null, '@media (prefers-color-scheme: dark) { svg { stroke: #e9eefb } }'),
  ),
);

const desktopPage = fileURLToPath(new URL('./desktop.html', import.meta.url));

export default defineConfig(({ mode }) => ({
  root: 'web',
  base: '/',
  publicDir: mode === 'desktop' ? false : 'public',
  plugins: [{
    name: 'brand-favicon',
    transformIndexHtml: () => [{
      tag: 'link',
      attrs: { rel: 'icon', type: 'image/svg+xml', sizes: 'any', href: `data:image/svg+xml,${encodeURIComponent(favicon)}` },
    }],
  }, ...(mode === 'desktop' ? [{
    name: 'desktop-offline-resources',
    closeBundle() {
      for (const directory of ['resources/v1', 'tutorial']) {
        cpSync(new URL(`./public/${directory}/`, import.meta.url),
          new URL(`../dist/desktop-client/${directory}/`, import.meta.url), { recursive: true });
      }
    },
  }] : [])],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/analysis': 'http://127.0.0.1:4319',
      '/api/chat': 'http://127.0.0.1:4320',
    },
  },
  build: {
    outDir: mode === 'desktop' ? '../dist/desktop-client' : '../dist/client',
    emptyOutDir: true,
    rollupOptions: mode === 'desktop' ? { input: desktopPage } : undefined,
    license: { fileName: 'third-party-licenses.md' },
  },
}));
