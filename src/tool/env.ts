// 运行环境：真实应用里用 Tauri 的文件和网络；浏览器预览里用内存里的文件夹和示例商品。
import { httpFetch } from '../kit/platform';
import { tauriFileIO, type Fetcher, type FileIO } from './io';
import { Library } from './library';
import { memoryIO } from './memio';
import { demoPayloads } from './demo';
import { DEFAULT_SETTINGS } from './types';

export interface Env { io: FileIO; lib: Library; root: string; inboxDir: string; fetcher: Fetcher; preview: boolean }

export const isPreview = typeof location !== 'undefined' && location.pathname.endsWith('preview.html');
/** 真实应用里为 true；浏览器预览页会模拟出 Tauri 对象，这里不算 */
export const inTauri = !isPreview && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** 预览里的缩略图（画出来的色块），按商品编号取 */
export const previewThumbs: Record<string, string[]> = {};

function drawThumb(seed: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = 120;
  const g = c.getContext('2d')!;
  const hues = [205, 28, 150, 350, 260, 45, 185, 95, 320, 10, 230, 70];
  const h = hues[seed % hues.length];
  g.fillStyle = `hsl(${h} 38% 88%)`;
  g.fillRect(0, 0, 120, 120);
  g.fillStyle = `hsl(${h} 45% 45%)`;
  g.beginPath();
  g.roundRect(38, 24, 44, 76, [18, 18, 8, 8]);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.fillRect(46, 34, 8, 52);
  return c.toDataURL('image/png');
}

export async function createEnv(): Promise<Env> {
  if (!inTauri) {
    const io = memoryIO();
    const root = '/library';
    const lib = new Library(io, root);
    await lib.init();
    // 预览：载入虚构示例商品，不联网
    const payloads = demoPayloads((seed) => drawThumb(seed));
    for (const [i, p] of payloads.entries()) {
      const { product } = await lib.upsertFromPayload(p, DEFAULT_SETTINGS);
      const urls = product.mainImages;
      previewThumbs[product.id] = urls;
      const done = {
        ...product,
        localMain: urls.map((_, k) => `main/main_0${k + 1}.png`),
        localDetail: product.detailImages.map((_, k) => `detail/detail_0${k + 1}.png`),
        status: i === 1 ? ('drafted' as const) : ('ready' as const),
        categoryPath: i === 0 ? '家居日用 > 水具 > 保温杯' : i === 1 ? '男装 > T恤 > T恤' : '',
        brand: i === 0 ? '示例品牌' : '',
        updatedAt: product.updatedAt - i * 1000,
      };
      await lib.save(done);
    }
    return { io, lib, root, inboxDir: '/inbox', fetcher: async () => ({ ok: false, status: 0, arrayBuffer: async () => new ArrayBuffer(0) }), preview: true };
  }
  const { appDataDir } = await import('@tauri-apps/api/path');
  const io = await tauriFileIO();
  const base = (await appDataDir()).replace(/[\\/]+$/, '');
  const root = io.join(base, 'library');
  const lib = new Library(io, root);
  await lib.init();
  await io.mkdir(io.join(base, 'inbox'));
  return { io, lib, root, inboxDir: io.join(base, 'inbox'), fetcher: httpFetch as unknown as Fetcher, preview: false };
}
