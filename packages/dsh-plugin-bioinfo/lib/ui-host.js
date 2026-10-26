import { workbenchUrl } from './client.js';

export const inject = ['webServer'];

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.tapIndex((html) => html.replace(/<title>[^<]*<\/title>/i, '<title>bioinfobuddy</title>')));
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__BIOINFO_WORKBENCH__', value: { url: workbenchUrl() } });
  });
}
