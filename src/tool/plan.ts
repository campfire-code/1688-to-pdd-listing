// 上架方案：把一条商品和设置整理成「要往拼多多后台填什么」。纯函数，上架前先在界面里预览。
import type { Product, ToolSettings } from './types';
import { categoryKeyword, clampChars } from './clean';
import { normalizePath } from './category';
import { buildSkuPlan, type SkuPlan } from './sku';
import { validCost } from './pricing';

/** 主图最多传 10 张（沿用参考实现，未核实平台上限，以平台为准） */
export const MAX_MAIN_IMAGES = 10;

export interface ListingPlan {
  id: string;
  title: string;
  categoryPath: string;
  keyword: string;
  brand: string;
  attrs: Record<string, string>;
  /** 要上传的主图（相对产品文件夹） */
  images: string[];
  sku: SkuPlan;
  shipTime: string;
  invoiceMode: string;
  promises: string[];
  /** 不处理就无法上架的问题 */
  blockers: string[];
  warnings: string[];
}

export function buildPlan(p: Product, s: ToolSettings): ListingPlan {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const title = clampChars((p.cleanTitle || p.title).trim(), s.titleMax);
  if (!title) blockers.push('缺少标题');
  if (!validCost(p.cost) && !p.skus.some((x) => Number(x.purchasePrice) > 0)) blockers.push('缺少进价（没有价格无法算售价）');
  const images = p.localMain.slice(0, MAX_MAIN_IMAGES);
  if (!images.length) blockers.push('没有已下载的主图（先在产品库里「下载图片」）');
  if (p.localMain.length > MAX_MAIN_IMAGES) warnings.push(`主图有 ${p.localMain.length} 张，只传前 ${MAX_MAIN_IMAGES} 张`);
  if (p.status === 'drafted') warnings.push('这件商品已经保存过草稿，再次上架会在后台产生重复草稿');
  if (p.status === 'submitted') warnings.push('这件商品已经提交上架过');
  const attrs = { ...p.attrs };
  const brand = (p.brand || attrs['品牌'] || '').trim();
  delete attrs['品牌'];
  const sku = buildSkuPlan(p, s);
  warnings.push(...sku.warnings);
  return {
    id: p.id,
    title,
    categoryPath: p.categoryPath.trim(),
    keyword: normalizePath(p.categoryPath).pop() ?? categoryKeyword(title, p.attrs),
    brand,
    attrs,
    images,
    sku,
    shipTime: s.shipTime,
    invoiceMode: s.invoiceMode,
    promises: s.promises,
    blockers,
    warnings,
  };
}
