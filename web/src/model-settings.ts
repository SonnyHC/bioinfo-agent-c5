import catalog from '../../config/model-providers.json';
export const providers = catalog.providers;
export type Provider = keyof typeof providers;
const KEY = 'bioinfobuddy-api-key';
const MODEL = 'bioinfobuddy-model';
export const PROVIDER = 'bioinfobuddy-provider';
export interface ModelSettings { provider: Provider; key: string; model: string; workspace: string; remember: boolean }
export function savedSettings(provider: Provider): ModelSettings {
  const local = localStorage.getItem(KEY + ':' + provider) || (provider === 'deepseek' ? localStorage.getItem(KEY) : null);
  const key = local || sessionStorage.getItem(KEY + ':' + provider) || (provider === 'deepseek' ? sessionStorage.getItem(KEY) : '') || '';
  let model = localStorage.getItem(MODEL + ':' + provider) || (provider === 'deepseek' ? localStorage.getItem(MODEL) : '') || providers[provider].model;
  if (provider === 'deepseek' && ['deepseek-chat','deepseek-reasoner'].includes(model)) model = providers.deepseek.model;
  return {provider,key,remember:!!local,model,workspace:localStorage.getItem('bioinfobuddy-workspace:' + provider) || ''};
}
export function storeSettings(value: ModelSettings) {
  if (!/^[\x21-\x7e]{8,512}$/.test(value.key.trim())) throw new Error('请填写有效的 API Key。');
  if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(value.model.trim())) throw new Error('请填写有效的模型名称。');
  if (value.provider === 'qwen' && value.workspace && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]$/.test(value.workspace)) throw new Error('请填写有效的百炼业务空间 ID。');
  const scopedKey = KEY + ':' + value.provider;
  localStorage.removeItem(scopedKey); sessionStorage.removeItem(scopedKey);
  if (value.provider === 'deepseek') {localStorage.removeItem(KEY);sessionStorage.removeItem(KEY);}
  (value.remember ? localStorage : sessionStorage).setItem(scopedKey,value.key.trim());
  localStorage.setItem(MODEL + ':' + value.provider,value.model.trim());
  localStorage.setItem('bioinfobuddy-workspace:' + value.provider,value.workspace.trim());
  localStorage.setItem(PROVIDER,value.provider);
}
