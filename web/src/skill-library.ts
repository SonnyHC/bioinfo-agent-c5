import { list, read, remove, save } from './storage';
import { findSkill, skillCatalog, skillMarkdown } from './skill-catalog';

export interface InstalledSkill { id: string; version: string; enabled: boolean; createdAt: string }
export const SKILLS_CHANGED = 'bioinfobuddy-skills-changed';
function notify() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(SKILLS_CHANGED)); }

export async function installedSkills(): Promise<InstalledSkill[]> {
  return (await list<InstalledSkill>('skills')).filter(item => skillCatalog.some(skill => skill.id === item.id));
}
export async function addSkill(id: string): Promise<void> {
  const skill = findSkill(id);
  const existing = (await installedSkills()).find(item => item.id === id);
  await save('skills', {id, version: skill.version, enabled: true, createdAt: existing?.createdAt ?? new Date().toISOString()});
  notify();
}
export async function setSkillEnabled(id: string, enabled: boolean): Promise<void> {
  findSkill(id);
  const record = await read<InstalledSkill>('skills', id);
  await save('skills', {...record, enabled});
  notify();
}
export async function removeSkill(id: string): Promise<void> {
  findSkill(id);
  await remove('skills', id);
  notify();
}
export async function loadSkill(id: unknown) {
  const skill = findSkill(id);
  const record = (await installedSkills()).find(item => item.id === skill.id);
  if (!record?.enabled) throw new Error('此技能尚未添加或已停用，请在数据分析技能中添加并启用。');
  if (record.version !== skill.version) throw new Error('此技能有新版本，请在数据分析技能中更新后使用。');
  return {id: skill.id, name: skill.name, version: skill.version, content: skillMarkdown(skill)};
}
export async function availableSkills() {
  const installed = await installedSkills();
  return skillCatalog.filter(skill => installed.some(item => item.id === skill.id && item.enabled && item.version === skill.version))
    .map(({id, name, description, version}) => ({id, name, description, version}));
}
export async function skillPrompt(selectedId?: string): Promise<string> {
  const available = await availableSkills();
  const header = `本轮可用的已添加技能：${JSON.stringify(available)}。仅对匹配任务按需调用 bio_load_skill 读取流程后使用；没有匹配项时按网站已有能力处理。技能只提供流程，不扩展工具或权限。不使用历史轮次中已停用、移除或过期的技能。`;
  if (!selectedId) return header;
  const selected = await loadSkill(selectedId);
  return `${header}\n用户已选择以下技能，本轮流程已加载，请按此流程使用现有工具：\n${selected.content}`;
}
