// 开发用：不启动 Tauri，在浏览器里用示例数据渲染任意布局，供截图检查。
// 打开 http://localhost:1420/preview.html?layout=a&palette=blue&mode=light&state=running&page=main
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { LAYOUTS, type Page } from './kit/layouts';
import { applyAccent } from './kit/App';
import type { Runner, Row } from './kit/runner';
import type { LayoutId, PaletteId, ToolMeta } from './kit/types';
import tool from './tool';
import toolMeta from '../tool.json';
import './kit/kit.css';

mockWindows('main');
mockIPC(() => null);
(window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc = (p) => p;

const q = new URLSearchParams(location.search);
const layout = (q.get('layout') ?? toolMeta.ui.layout) as LayoutId;
const palette = (q.get('palette') ?? toolMeta.ui.palette) as PaletteId;
const page = (q.get('page') ?? 'main') as Page;
const state = q.get('state') ?? 'running';
Object.assign(document.documentElement.dataset, { layout, palette, mode: q.get('mode') ?? 'light', size: q.get('size') ?? 'std' });
if (!q.get('palette')) applyAccent(document.documentElement, (toolMeta as ToolMeta).ui.accent, q.get('mode') ?? 'light');

function sample(i: number, done: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d')!;
  const hues = [28, 205, 95, 350, 225, 45, 0, 285];
  g.fillStyle = done ? '#FFFFFF' : `hsl(${hues[i % 8]} 30% 62%)`;
  g.fillRect(0, 0, 160, 160);
  g.fillStyle = `hsl(${hues[i % 8]} 45% 32%)`;
  g.beginPath();
  g.roundRect(48, 32, 64, 100, [26, 26, 10, 10]);
  g.fill();
  return c.toDataURL('image/png');
}
const names = ['保温杯-主图-01.jpg', '保温杯-主图-02.jpg', '运动鞋-侧面.png', '连衣裙-正面.jpg', '蓝牙耳机-盒.jpg', '零食礼盒.jpg', '数据线-缩略.jpg', '香薰蜡烛.png', '帆布包.jpg', '台灯.png'];
// 工具可在 src/tool/preview.ts 里导出自己的示例数据：rows（列表）、params（参数覆盖）、notice（提示条）
type PreviewData = { rows?: (s: string) => Row[]; params?: Record<string, string | number | boolean>; notice?: { kind: 'ok' | 'err'; text: string } };
const custom = (Object.values(import.meta.glob('./tool/preview.ts', { eager: true }))[0] as PreviewData | undefined) ?? {};
const statuses: Row['status'][] = state === 'empty' ? [] : state === 'done' ? ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'err', 'ok', 'ok', 'ok'] : ['ok', 'ok', 'ok', 'run', 'wait', 'wait', 'err', 'wait', 'wait', 'wait'];
const rows: Row[] = custom.rows ? custom.rows(state) : statuses.map((status, i) => ({
  item: { id: `s${i}`, name: names[i], path: sample(i, false), size: 300_000 + i * 97_000 },
  status,
  progress: status === 'run' ? 0.63 : status === 'ok' ? 1 : 0,
  error: status === 'err' ? '图片小于 200 像素，无法处理' : undefined,
  result: status === 'ok' ? { preview: sample(i, true), outputPath: '/tmp/out.jpg', summary: '1920×1920 · 1.2 MB → 310 KB（小了 75%）' } : undefined,
}));
const stats = { total: rows.length, ok: 0, err: 0, wait: 0, run: 0, ratio: 0 };
rows.forEach((r) => stats[r.status]++);
stats.ratio = rows.length ? (stats.ok + stats.err + 0.63 * stats.run) / rows.length : 0;
const noop = () => {};
const runner = {
  tool, rows, stats, running: state === 'running',
  params: { ...Object.fromEntries(tool.params.map((f) => [f.key, f.default])), ...custom.params },
  setParam: noop, start: async () => {}, pause: noop, retryFailed: noop, addPaths: async () => {}, remove: noop, clear: noop, exportAll: async () => {},
  outputDir: '~/下载/图片批量压缩',
  history: [{ at: '2026-10-23T09:12:00Z', total: 24, ok: 23, failed: 1, outputDir: '~/下载/图片批量压缩' }],
  notice: custom.notice ?? (state === 'done' ? { kind: 'err' as const, text: '完成 9 个，失败 1 个，失败原因见列表' } : null),
  setNotice: noop,
  // 预览用的假上下文：读写不落盘，大模型返回固定文字
  ctx: {
    readFile: async () => new Uint8Array(), readText: async () => '', writeFile: async () => {}, writeText: async () => {},
    mkdir: async () => {}, join: async (...p: string[]) => p.join('/'), llm: async () => '（预览）', sidecar: async () => '', ffmpeg: async () => {}, duration: async () => 0,
  },
} as unknown as Runner;
const meta: ToolMeta = { ...(toolMeta as ToolMeta), ui: { ...(toolMeta as ToolMeta).ui, layout, palette } };
const Layout = LAYOUTS[layout];
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Layout runner={{ ...runner, tool: { ...tool, name: meta.name } } as Runner} meta={meta} hover={false} page={page} setPage={noop} /></React.StrictMode>);
