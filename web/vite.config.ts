import { defineConfig } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dna } from 'lucide-react';

const favicon = renderToStaticMarkup(
  createElement(Dna, { color: '#20304b' },
    createElement('style', null, '@media (prefers-color-scheme: dark) { svg { stroke: #e9eefb } }'),
  ),
);

export default defineConfig({
  root: 'web',
  base: '/',
  plugins: [{
    name: 'brand-favicon',
    transformIndexHtml: () => [{
      tag: 'link',
      attrs: { rel: 'icon', type: 'image/svg+xml', sizes: 'any', href: `data:image/svg+xml,${encodeURIComponent(favicon)}` },
    }],
  }],
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
