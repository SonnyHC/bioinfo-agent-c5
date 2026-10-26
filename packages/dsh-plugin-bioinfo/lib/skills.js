import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const name = 'bioinfo-skills';
export const inject = ['skills'];
const folder = fileURLToPath(new URL('../skills/reviewed-bio-plot/', import.meta.url));
const file = fileURLToPath(new URL('../skills/reviewed-bio-plot/SKILL.md', import.meta.url));

export function apply(ctx) {
  const candidate = {
    name: 'reviewed-bio-plot',
    description: '从 CSV/Excel 的真实字段生成待确认绘图方案，调用固定模板绘图并核对可复现结果。',
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled', provider: 'bioinfo-c5', path: file,
    resourceBase: { kind: 'directory', path: folder }, rank: 600,
  };
  ctx.skills.registerProvider(() => ({
    name: 'bioinfo-c5',
    list: async () => [candidate],
    get: async () => ({ ...candidate, content: readFileSync(file, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') }),
  }));
}
