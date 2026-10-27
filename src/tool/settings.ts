// 工具设置的读写（保存在本机 settings.json 里的 e01 项）。
import { useEffect, useState } from 'react';
import { settingsStore } from '../kit/platform';
import { DEFAULT_SETTINGS, type ToolSettings } from './types';

const KEY = 'e01';
let current: ToolSettings = DEFAULT_SETTINGS;
let loaded: Promise<ToolSettings> | null = null;
const listeners = new Set<(s: ToolSettings) => void>();

export function normalizeSettings(raw: Partial<ToolSettings> | undefined | null): ToolSettings {
  const r = raw ?? {};
  const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const names = Array.isArray(r.specTypeNames) ? r.specTypeNames : [];
  return {
    titleMax: Math.round(num(r.titleMax, DEFAULT_SETTINGS.titleMax, 10, 60)),
    groupMultiplier: num(r.groupMultiplier, DEFAULT_SETTINGS.groupMultiplier, 0.1, 100),
    singleMultiplier: num(r.singleMultiplier, DEFAULT_SETTINGS.singleMultiplier, 0.1, 100),
    defaultStock: Math.round(num(r.defaultStock, DEFAULT_SETTINGS.defaultStock, 0, 99999)),
    shipTime: str(r.shipTime, DEFAULT_SETTINGS.shipTime),
    invoiceMode: str(r.invoiceMode, DEFAULT_SETTINGS.invoiceMode),
    promises: Array.isArray(r.promises) ? r.promises.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [],
    allowSubmit: r.allowSubmit === true,
    uncertainCategory: r.uncertainCategory === 'best' ? 'best' : 'pause',
    specTypeNames: [str(names[0], DEFAULT_SETTINGS.specTypeNames[0]) || DEFAULT_SETTINGS.specTypeNames[0], str(names[1], DEFAULT_SETTINGS.specTypeNames[1]) || DEFAULT_SETTINGS.specTypeNames[1]],
    logisticsTemplate: str(r.logisticsTemplate, ''),
    cleanProfile: r.cleanProfile === 'scene' || r.cleanProfile === 'minimal' ? r.cleanProfile : 'marketplace',
    autoDownload: r.autoDownload !== false,
  };
}

export function loadToolSettings(): Promise<ToolSettings> {
  return (loaded ??= settingsStore()
    .then(async (st) => (current = normalizeSettings(await st.get<Partial<ToolSettings>>(KEY))))
    .catch(() => current));
}

export async function saveToolSettings(patch: Partial<ToolSettings>): Promise<ToolSettings> {
  current = normalizeSettings({ ...current, ...patch });
  listeners.forEach((l) => l(current));
  try { await (await settingsStore()).set(KEY, current); } catch { /* 浏览器预览里没有本机存储 */ }
  return current;
}

export function useToolSettings(): [ToolSettings, (patch: Partial<ToolSettings>) => void] {
  const [s, setS] = useState(current);
  useEffect(() => {
    loadToolSettings().then(setS);
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return [s, (patch) => void saveToolSettings(patch)];
}
