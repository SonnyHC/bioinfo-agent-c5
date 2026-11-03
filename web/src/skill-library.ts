import { list, updateAll } from './storage';
import { findSkill, skillCatalog, skillMarkdown } from './skill-catalog';

export interface InstalledSkill { id: string; version: string; enabled: boolean; createdAt: string }
export const SKILLS_CHANGED = 'bioinfobuddy-skills-changed';
function notify() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(SKILLS_CHANGED)); }

function migrateSkills(values: InstalledSkill[]): InstalledSkill[] {
  const records = new Map(values.map(value => [value.id, value]));
  const evidence = records.get('cell-annotation-evidence');
  const review = records.get('cell-annotation-review');
  if (!review && evidence) {
    records.set('cell-annotation-review', {...evidence, id: 'cell-annotation-review', version: '1.1.0'});
  } else if (review?.version === '1.0.0') {
    records.set(review.id, {...review, version: '1.1.0'});
  }
  records.delete('cell-annotation-evidence');

  const combined = records.get('differential-enrichment-guide');
  if (combined) {
    for (const id of ['differential-expression', 'functional-enrichment']) {
      if (!records.has(id)) records.set(id, {...combined, id, version: '1.0.0'});
    }
    records.delete(combined.id);
  }
  return [...records.values()];
}

export async function installedSkills(): Promise<InstalledSkill[]> {
  const stored = await list<InstalledSkill>('skills');
  const needsMigration = stored.some(item => item.id === 'cell-annotation-evidence'
    || item.id === 'differential-enrichment-guide' || item.id === 'cell-annotation-review' && item.version === '1.0.0');
  const records = needsMigration ? await updateAll('skills', migrateSkills) : stored;
  return records
    .filter(item => skillCatalog.some(skill => skill.id === item.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function addSkill(id: string): Promise<void> {
  const skill = findSkill(id);
  await updateAll<InstalledSkill>('skills', values => {
    const migrated = migrateSkills(values);
    const existing = migrated.find(item => item.id === id);
    return [...migrated.filter(item => item.id !== id), {id, version: skill.version, enabled: true, createdAt: existing?.createdAt ?? new Date().toISOString()}];
  });
  notify();
}
export async function setSkillEnabled(id: string, enabled: boolean): Promise<void> {
  findSkill(id);
  await updateAll<InstalledSkill>('skills', values => {
    const migrated = migrateSkills(values);
    if (!migrated.some(item => item.id === id)) throw new Error('此浏览器中找不到这条记录。');
    return migrated.map(item => item.id === id ? {...item, enabled} : item);
  });
  notify();
}
export async function removeSkill(id: string): Promise<void> {
  findSkill(id);
  await updateAll<InstalledSkill>('skills', values => migrateSkills(values).filter(item => item.id !== id));
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
