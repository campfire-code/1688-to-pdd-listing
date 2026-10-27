// 本地产品库：每个商品一个文件夹 <库>/<编号>/product.json，图片在 main/ 和 detail/ 下。
// 不用数据库：文件夹可以直接复制、备份、拷到别的电脑。
import type { Fetcher, FileIO } from './io';
import type { ExtensionPayload, Product, ToolSettings } from './types';
import { fromExtension, mergeRecollect } from './import';
import { downloadImages } from './images';

const safeId = (id: string) => id.replace(/[^\w一-龥.-]/g, '_');

export class Library {
  constructor(public io: FileIO, public root: string) {}

  dirOf(id: string) { return this.io.join(this.root, safeId(id)); }
  async init() { await this.io.mkdir(this.root); }

  async list(): Promise<Product[]> {
    if (!(await this.io.exists(this.root))) return [];
    const out: Product[] = [];
    for (const name of await this.io.list(this.root)) {
      if (name.startsWith('.')) continue;
      const file = this.io.join(this.root, name, 'product.json');
      try {
        if (await this.io.exists(file)) out.push(JSON.parse(await this.io.readText(file)) as Product);
      } catch {
        // 坏掉的单个文件不影响其它商品
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Product | null> {
    const file = this.io.join(this.dirOf(id), 'product.json');
    return (await this.io.exists(file)) ? (JSON.parse(await this.io.readText(file)) as Product) : null;
  }

  async save(p: Product): Promise<void> {
    await this.io.mkdir(this.dirOf(p.id));
    await this.io.writeText(this.io.join(this.dirOf(p.id), 'product.json'), JSON.stringify(p, null, 2));
  }

  async remove(id: string): Promise<void> { await this.io.remove(this.dirOf(id), true); }

  /** 本地图片的完整路径（上架传图、导出数据包用） */
  imagePath(p: Product, rel: string) { return this.io.join(this.dirOf(p.id), rel); }

  /** 入库一条采集数据：新商品直接保存，已有的合并更新。原始 JSON 另存 source.json 兜底。 */
  async upsertFromPayload(payload: ExtensionPayload, settings: ToolSettings): Promise<{ product: Product; created: boolean }> {
    const fresh = fromExtension(payload, { titleMax: settings.titleMax });
    const old = await this.get(fresh.id);
    const product = old ? mergeRecollect(old, fresh, settings.titleMax) : fresh;
    await this.save(product);
    await this.io.writeText(this.io.join(this.dirOf(product.id), 'source.json'), JSON.stringify(payload, null, 2));
    return { product, created: !old };
  }

  /** 下载主图和详情图；已经下载过且图片地址没变的不重复下载 */
  async downloadImages(id: string, fetcher: Fetcher, opts: { force?: boolean; signal?: AbortSignal; onEach?: (done: number, total: number) => void } = {}): Promise<Product> {
    const p = await this.get(id);
    if (!p) throw new Error(`产品库里没有 ${id}`);
    if (!opts.force && p.localMain.length) return p;
    const deps = { io: this.io, fetcher, platform: p.platform, signal: opts.signal, onEach: opts.onEach };
    const dir = this.dirOf(p.id);
    const main = await downloadImages(p.mainImages, dir, 'main', 'main', deps);
    const detail = await downloadImages(p.detailImages, dir, 'detail', 'detail', deps);
    const next: Product = {
      ...p,
      localMain: main.saved,
      localDetail: detail.saved,
      status: p.status === 'drafted' || p.status === 'submitted' ? p.status : main.saved.length ? 'ready' : 'collected',
      lastError: main.saved.length ? '' : '主图一张都没下载成功',
      updatedAt: Date.now(),
    };
    await this.save(next);
    return next;
  }

  /**
   * 处理收件箱：插件发来的 JSON 逐个入库并（按设置）下载图片，处理完删除。
   * 解析不了的文件挪到 _failed/，不会反复报错。
   */
  async importInbox(inboxDir: string, settings: ToolSettings, fetcher: Fetcher, onProgress?: (msg: string) => void): Promise<{ imported: Product[]; failed: string[] }> {
    const imported: Product[] = [];
    const failed: string[] = [];
    if (!(await this.io.exists(inboxDir))) return { imported, failed };
    const names = (await this.io.list(inboxDir)).filter((n) => n.endsWith('.json')).sort();
    for (const name of names) {
      const file = this.io.join(inboxDir, name);
      try {
        const payload = JSON.parse(await this.io.readText(file)) as ExtensionPayload;
        if (!payload || typeof payload.productName !== 'string' || !payload.productName.trim()) throw new Error('不是商品数据');
        const { product } = await this.upsertFromPayload(payload, settings);
        onProgress?.(`已入库：${product.cleanTitle || product.title}`);
        imported.push(settings.autoDownload ? await this.downloadImages(product.id, fetcher, { force: true }) : product);
        await this.io.remove(file);
      } catch (e) {
        failed.push(`${name}：${e instanceof Error ? e.message : String(e)}`);
        const bad = this.io.join(inboxDir, '_failed');
        await this.io.mkdir(bad);
        await this.io.writeText(this.io.join(bad, name), await this.io.readText(file).catch(() => ''));
        await this.io.remove(file).catch(() => {});
      }
    }
    return { imported, failed };
  }
}

/** 文件里可能是一条商品（插件格式）、数组，或 { data: 商品 }，都收下来 */
export function parsePayloadFile(text: string): ExtensionPayload[] {
  const raw = JSON.parse(text) as unknown;
  const list = Array.isArray(raw) ? raw : [raw];
  const out: ExtensionPayload[] = [];
  for (const x of list) {
    const item = (x && typeof x === 'object' && 'data' in x ? (x as { data: unknown }).data : x) as ExtensionPayload;
    if (item && typeof item === 'object' && typeof item.productName === 'string' && item.productName.trim()) out.push(item);
  }
  if (!out.length) throw new Error('文件里没有找到商品数据（需要 productName 字段，是浏览器插件采集的格式）');
  return out;
}
