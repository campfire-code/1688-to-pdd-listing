// 用户设置：大模型接口与外观。只保存在本机 settings.json，不上传。
import { useEffect, useState } from 'react';
import { settingsStore, httpFetch } from './platform';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}
export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  llm: LlmConfig;
  theme: ThemePref;
}

export const LLM_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '其他（兼容 OpenAI 接口）', baseUrl: '', model: '' },
];

const DEFAULTS: Settings = { llm: { baseUrl: '', apiKey: '', model: '' }, theme: 'system' };

type Listener = (s: Settings) => void;
let current: Settings = DEFAULTS;
let loaded: Promise<Settings> | null = null;
const listeners = new Set<Listener>();

export function loadSettings() {
  return (loaded ??= settingsStore()
    .then(async (st) => {
      current = { ...DEFAULTS, llm: { ...DEFAULTS.llm, ...((await st.get<LlmConfig>('llm')) ?? {}) }, theme: (await st.get<ThemePref>('theme')) ?? 'system' };
      return current;
    })
    // 设置文件读不到（例如浏览器预览）时用默认值，不让界面报错
    .catch(() => current));
}

export async function saveSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  const st = await settingsStore();
  if (patch.llm) await st.set('llm', current.llm);
  if (patch.theme) await st.set('theme', current.theme);
  listeners.forEach((l) => l(current));
}

export function useSettings(): Settings {
  const [s, setS] = useState(current);
  useEffect(() => {
    loadSettings().then(setS);
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}

export const llmReady = (c: LlmConfig) => Boolean(c.baseUrl && c.apiKey && c.model);

/** 调用 OpenAI 兼容的 /chat/completions，返回第一条回复 */
export async function chat(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { json?: boolean; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { llm } = await loadSettings();
  if (!llmReady(llm)) throw new Error('还没有设置大模型：请到「设置」里填写接口地址、密钥和模型名');
  const res = await httpFetch(llm.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      messages,
      temperature: opts.temperature ?? 0.7,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401 ? '密钥不对或已过期' : res.status === 404 ? '接口地址或模型名不对' : res.status === 429 ? '调用太频繁或额度用完' : '接口返回错误';
    throw new Error(`大模型调用失败（${res.status}，${hint}）${body ? '：' + body.slice(0, 160) : ''}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('大模型没有返回内容');
  return text;
}
