// 主界面：顶部页签（产品库 / 上架 / 导出数据包 / 采集插件 / 设置），数据都在本机。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Download, Puzzle, Send, SlidersHorizontal } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { errText, type AppCtx, type Notice, type TabId } from './app';
import { createEnv, inTauri, isPreview, type Env } from './env';
import { useToolSettings } from './settings';
import type { Product } from './types';
import { LibraryTab } from './LibraryTab';
import { ListingTab } from './ListingTab';
import { ExportTab } from './ExportTab';
import { PluginTab } from './PluginTab';
import { SettingsTab } from './SettingsTab';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
const pad = (n: number) => String(n).padStart(2, '0');

export function Main({ ctx }: { ctx?: Ctx }) {
  void ctx;
  const [env, setEnv] = useState<Env | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useToolSettings();
  const initialTab = (new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('tab') as TabId | null) ?? 'library';
  const [tab, setTab] = useState<TabId>(initialTab);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const envRef = useRef<Env | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const draining = useRef<Promise<void>>(Promise.resolve());

  const say = useCallback((t: string) => setLog((l) => [`${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:${pad(new Date().getSeconds())}  ${t}`, ...l].slice(0, 200)), []);

  const reload = useCallback(async () => {
    const e = envRef.current;
    if (!e) return;
    setProducts(await e.lib.list());
  }, []);

  // 收件箱：插件发来的商品先落盘在这里，应用开着时马上入库，没开着时下次启动补入库
  const drain = useCallback(() => {
    draining.current = draining.current.then(async () => {
      const e = envRef.current;
      if (!e || e.preview) return;
      try {
        const r = await e.lib.importInbox(e.inboxDir, settingsRef.current, e.fetcher, say);
        if (r.imported.length) {
          setNotice({ kind: 'ok', text: `从浏览器插件收到 ${r.imported.length} 件商品，已入库${settingsRef.current.autoDownload ? '并下载了图片' : ''}` });
          setSelected((s) => new Set([...s, ...r.imported.map((p) => p.id)]));
        }
        if (r.failed.length) setNotice({ kind: 'err', text: `有 ${r.failed.length} 个文件入库失败：${r.failed[0]}` });
        await reload();
      } catch (err) {
        setNotice({ kind: 'err', text: `处理插件数据失败：${errText(err)}` });
      }
    });
    return draining.current;
  }, [reload, say]);

  useEffect(() => {
    let dead = false;
    let off: (() => void) | undefined;
    (async () => {
      const e = await createEnv();
      if (dead) return;
      envRef.current = e;
      setEnv(e);
      setProducts(await e.lib.list());
      if (isPreview) {
        const list = await e.lib.list();
        setSelected(new Set(list.slice(0, 2).map((p) => p.id)));
        setActiveId(list[0]?.id ?? null);
        say('已载入示例商品（预览）');
        return;
      }
      await drain();
      if (inTauri) {
        const { listen } = await import('@tauri-apps/api/event');
        const un = await listen('collector-inbox', () => void drain());
        if (dead) un(); else off = un;
      }
    })().catch((err) => setNotice({ kind: 'err', text: `启动失败：${errText(err)}` }));
    return () => { dead = true; off?.(); };
  }, [drain, say]);

  const app: AppCtx = useMemo(() => ({
    env, products, reload, settings, setSettings, selected, setSelected, activeId, setActiveId, notice, setNotice, say, log, busy, setBusy, goto: setTab,
    save: async (p: Product) => { await envRef.current?.lib.save({ ...p, updatedAt: Date.now() }); await reload(); },
  }), [env, products, reload, settings, setSettings, selected, activeId, notice, say, log, busy]);

  const TABS: [TabId, string, typeof Boxes][] = [
    ['library', `产品库（${products.length}）`, Boxes],
    ['listing', '上架到拼多多', Send],
    ['export', '导出数据包', Download],
    ['plugin', '采集插件', Puzzle],
    ['settings', '规则与设置', SlidersHorizontal],
  ];

  return (
    <div className="pp-root">
      <div className="k-seg pp-tabs" role="tablist">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={14} />{label}</button>
        ))}
      </div>
      {notice && (
        <div className={`k-notice ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button className="k-link" onClick={() => setNotice(null)}>知道了</button>
        </div>
      )}
      <div className="pp-body">
        {tab === 'library' && <LibraryTab app={app} />}
        {tab === 'listing' && <ListingTab app={app} />}
        {tab === 'export' && <ExportTab app={app} />}
        {tab === 'plugin' && <PluginTab app={app} drain={drain} />}
        {tab === 'settings' && <SettingsTab app={app} />}
      </div>
    </div>
  );
}
