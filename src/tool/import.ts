// 把插件发来的 JSON 变成产品库里的一条商品。纯函数，不碰文件和网络。
import type { ExtSku, ExtensionPayload, Platform, Product } from './types';
import { cleanTitle } from './clean';

/** 从商品链接里取来源编号：1688 是 offer/数字，淘宝和天猫是 id=数字（加 tb_ 前缀避免和 1688 撞号） */
export function offerIdFromUrl(url: string): string {
  if (!url) return '';
  const m1688 = /offer\/(\d+)/.exec(url);
  if (m1688) return m1688[1];
  const m = /[?&](?:id|itemId|item_id|item_num_id)=(\d+)/.exec(url);
  return m ? `tb_${m[1]}` : '';
}

export function platformFromUrl(url: string, hint?: string): Platform {
  const h = (hint ?? '').toLowerCase();
  if (h === 'tmall' || h === 'taobao') return h;
  if (/1688\.com/i.test(url)) return '1688';
  if (/tmall\.(com|hk)/i.test(url)) return 'tmall';
  if (/taobao\.com/i.test(url)) return 'taobao';
  return h === '1688' ? '1688' : 'other';
}

/** 描述里「材质: PP塑料」这样一行一条的属性 */
export function parseAttrLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:：]{1,29})[:：]\s*(.+)$/.exec(line);
    if (m && m[1].trim() && m[2].trim()) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

/** 「k:v;k2:v2」写法（支持中文冒号和分号），产品库界面里编辑属性用 */
export function parseAttrKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const piece of (text ?? '').replace(/；/g, ';').replace(/：/g, ':').split(/[;\n]/)) {
    const i = piece.indexOf(':');
    if (i <= 0) continue;
    const k = piece.slice(0, i).trim();
    const v = piece.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}
export const attrsToKv = (a: Record<string, string>) => Object.entries(a).map(([k, v]) => `${k}:${v}`).join('\n');

export function minPrice(skus: ExtSku[] | undefined, fallback?: unknown): number | null {
  const prices = (skus ?? []).map((s) => Number(s.purchasePrice)).filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length) return Math.min(...prices);
  const f = Number(fallback);
  return Number.isFinite(f) && f > 0 ? f : null;
}

/** 图片地址整理：补协议、去掉不能下载的、按「去掉参数后的地址」去重 */
export function normalizeImageUrls(urls: unknown, limit = 30, exclude: Set<string> = new Set()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(urls) ? urls : []) {
    if (typeof raw !== 'string') continue;
    let u = raw.trim();
    if (u.startsWith('//')) u = 'https:' + u;
    if (!/^https?:\/\//i.test(u) && !/^data:image\//i.test(u)) continue;
    if (/\.gif(\?|$)/i.test(u) && !u.startsWith('data:')) continue;
    const key = u.startsWith('data:') ? u : u.split('?')[0];
    if (seen.has(key) || exclude.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 30);

export function fromExtension(raw: ExtensionPayload, opts: { titleMax: number; now?: number }): Product {
  const now = opts.now ?? Date.now();
  const sourceUrl = (raw.sourceUrl ?? '').trim();
  const title = (raw.productName ?? '').trim();
  const id = offerIdFromUrl(sourceUrl) || `noid_${slug(title) || 'item'}`;
  const mains = normalizeImageUrls(raw.images, 30);
  const mainKeys = new Set(mains.map((u) => u.split('?')[0]));
  const skus = (Array.isArray(raw.skuList) ? raw.skuList : []).filter((s) => s && typeof s.name === 'string' && s.name.trim());
  const weight = Number(raw.weight_g);
  return {
    id,
    platform: platformFromUrl(sourceUrl, raw.platform),
    sourceUrl,
    title,
    cleanTitle: cleanTitle(title, opts.titleMax),
    shop: (raw.shopName ?? '').trim(),
    cost: minPrice(skus, undefined),
    description: (raw.description ?? '').trim(),
    attrs: parseAttrLines(raw.description ?? ''),
    brand: '',
    weightKg: Number.isFinite(weight) && weight > 0 ? Math.round(weight) / 1000 : null,
    mainImages: mains,
    detailImages: normalizeImageUrls(raw.detailImages, 30, mainKeys),
    localMain: [],
    localDetail: [],
    skus,
    categoryPath: '',
    note: '',
    status: 'collected',
    lastError: '',
    collectedAt: now,
    updatedAt: now,
  };
}

/** 同一商品重复采集：更新来源数据，保留用户自己填的类目、备注、品牌，以及手改过的标题 */
export function mergeRecollect(old: Product, fresh: Product, titleMax: number): Product {
  const userEditedTitle = old.cleanTitle !== cleanTitle(old.title, titleMax);
  const sameImages = JSON.stringify(old.mainImages) === JSON.stringify(fresh.mainImages) && JSON.stringify(old.detailImages) === JSON.stringify(fresh.detailImages);
  return {
    ...fresh,
    cleanTitle: userEditedTitle ? old.cleanTitle : fresh.cleanTitle,
    brand: old.brand,
    categoryPath: old.categoryPath,
    note: old.note,
    attrs: { ...fresh.attrs, ...old.attrs },
    localMain: sameImages ? old.localMain : [],
    localDetail: sameImages ? old.localDetail : [],
    status: sameImages && old.status !== 'failed' ? old.status : 'collected',
    collectedAt: old.collectedAt,
    updatedAt: fresh.updatedAt,
  };
}
