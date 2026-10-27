// 各个页签共用的状态和动作。
import type { Env } from './env';
import type { Product, ToolSettings } from './types';

export type TabId = 'library' | 'listing' | 'export' | 'plugin' | 'settings';
export interface Notice { kind: 'ok' | 'err'; text: string; path?: string }

export interface AppCtx {
  env: Env | null;
  products: Product[];
  reload(): Promise<void>;
  settings: ToolSettings;
  setSettings(patch: Partial<ToolSettings>): void;
  selected: Set<string>;
  setSelected(next: Set<string>): void;
  activeId: string | null;
  setActiveId(id: string | null): void;
  notice: Notice | null;
  setNotice(n: Notice | null): void;
  say(text: string): void;
  log: string[];
  busy: string;
  setBusy(label: string): void;
  goto(tab: TabId): void;
  /** 在窗口外部显示某个路径（预览里什么也不做） */
  save(p: Product): Promise<void>;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const statusLabel: Record<Product['status'], [string, string]> = {
  collected: ['待下载图片', 'wait'],
  ready: ['可上架', 'run'],
  drafted: ['已存草稿', 'ok'],
  submitted: ['已提交上架', 'ok'],
  failed: ['上次失败', 'err'],
};
