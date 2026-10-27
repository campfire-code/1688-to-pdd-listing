// 导出「上架数据包」：Excel / CSV 商品表 + 规格明细 + 图片文件夹，供人工导入或对照填写。
// 商品表的列名按参考实现已知的字段整理（标题、类目、价格、库存、主图、详情图、规格、描述、属性、品牌、重量、物流模板）。
import ExcelJS from 'exceljs';
import type { FileIO } from './io';
import { attrsToKv } from './import';
import { buildPlan } from './plan';
import type { Library } from './library';
import type { Product, ToolSettings } from './types';

export const PRODUCT_HEADERS = [
  '商品标题', '类目', '价格(拼单价)', '单买价', '库存', '主图', '详情图', '规格', '组合明细',
  '描述', '商品属性', '品牌', '重量(kg)', '物流模板', '进价', '来源链接', '来源编号', '待处理',
] as const;
export const SKU_HEADERS = ['来源编号', '商品标题', '规格组合', '拼单价', '单买价', '库存', '进价', '说明'] as const;

type Cell = string | number;
export interface Table { headers: readonly string[]; rows: Cell[][] }

/** 值里的分隔符换成全角，避免和「;」「:」「/」的分隔规则混淆 */
const safe = (v: string) => v.replace(/;/g, '；').replace(/:/g, '：').replace(/\//g, '／').replace(/\r?\n/g, ' ');

export function specCell(p: Product, s: ToolSettings): string {
  return buildPlan(p, s).sku.specs.map((sp) => `${safe(sp.name)}:${sp.values.map(safe).join('/')}`).join(';');
}

export function buildTables(products: Product[], s: ToolSettings): { products: Table; skus: Table } {
  const prodRows: Cell[][] = [];
  const skuRows: Cell[][] = [];
  for (const p of products) {
    const plan = buildPlan(p, s);
    const rows = plan.sku.rows;
    const groups = rows.filter((r) => !r.filler).map((r) => r.group);
    const singles = rows.filter((r) => !r.filler).map((r) => r.single);
    const rel = (arr: string[]) => arr.map((f) => `${p.id}/${f.split('/').pop()}`).join(';');
    prodRows.push([
      plan.title,
      p.categoryPath,
      groups.length ? Math.min(...groups) : '',
      singles.length ? Math.min(...singles) : '',
      rows.reduce((n, r) => n + r.stock, 0),
      rel(p.localMain.slice(0, 10)),
      rel(p.localDetail),
      specCell(p, s),
      rows.filter((r) => !r.filler).map((r) => `${r.combo.map(safe).join('+') || '默认'}|${r.group}|${r.single}|${r.stock}`).join(';'),
      p.description,
      attrsToKv({ ...p.attrs }).replace(/\n/g, ';'),
      plan.brand,
      p.weightKg ?? '',
      s.logisticsTemplate,
      p.cost ?? '',
      p.sourceUrl,
      p.id,
      [...plan.blockers, ...plan.warnings].join('；'),
    ]);
    for (const r of rows) {
      skuRows.push([p.id, plan.title, r.combo.join(' + ') || '默认', r.group, r.single, r.stock, r.cost, r.filler ? '1688 里没有这个组合，库存已设为 0' : '']);
    }
  }
  return { products: { headers: PRODUCT_HEADERS, rows: prodRows }, skus: { headers: SKU_HEADERS, rows: skuRows } };
}

/** CSV：带 BOM，Excel 直接打开不乱码；含逗号、引号、换行的单元格加引号 */
export function toCsv(t: Table): string {
  const esc = (v: Cell) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [t.headers, ...t.rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export async function toXlsx(prod: Table, skus: Table): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, t: Table, widths: number[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([...t.headers]);
    for (const r of t.rows) ws.addRow(r.map((c) => (typeof c === 'string' ? c.slice(0, 32000) : c)));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  };
  add('商品', prod, [34, 26, 14, 10, 8, 40, 40, 30, 50, 40, 40, 12, 10, 14, 8, 40, 14, 30]);
  add('规格明细', skus, [14, 34, 28, 10, 10, 8, 8, 30]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export interface PackOptions { formats: ('xlsx' | 'csv')[]; images: boolean; dirName?: string }

/** 写出数据包文件夹，返回文件夹路径和写出的文件 */
export async function writePack(
  products: Product[], s: ToolSettings, lib: Library, io: FileIO, outDir: string, opt: PackOptions,
): Promise<{ dir: string; files: string[]; imageCount: number }> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const dir = io.join(outDir, opt.dirName ?? `上架数据包-${stamp}`);
  await io.mkdir(dir);
  const { products: pt, skus: st } = buildTables(products, s);
  const files: string[] = [];
  const put = async (name: string, data: string | Uint8Array) => {
    const f = io.join(dir, name);
    if (typeof data === 'string') await io.writeText(f, data); else await io.writeBytes(f, data);
    files.push(name);
  };
  if (opt.formats.includes('xlsx')) await put('商品表.xlsx', await toXlsx(pt, st));
  if (opt.formats.includes('csv')) {
    await put('商品表.csv', toCsv(pt));
    await put('规格明细.csv', toCsv(st));
  }
  let imageCount = 0;
  if (opt.images) {
    for (const p of products) {
      const target = io.join(dir, 'images', p.id);
      await io.mkdir(target);
      for (const rel of [...p.localMain, ...p.localDetail]) {
        await io.writeBytes(io.join(target, rel.split('/').pop() ?? rel), await io.readBytes(lib.imagePath(p, rel)));
        imageCount++;
      }
    }
  }
  return { dir, files, imageCount };
}

/** 参考实现读表格时的表头识别规则（子串匹配、先匹配到的字段优先），用来检查本数据包的列名不会被认错 */
export const REFERENCE_ALIASES: Record<string, string[]> = {
  title: ['标题', '商品标题', '商品名', '商品名称', 'title', 'name'],
  category: ['类目', '分类', '商品类目', 'category'],
  price: ['价格', '售价', '单价', 'price'],
  stock: ['库存', '数量', 'stock', 'qty'],
  main_images: ['主图', '主图列表', 'main_images', 'imgs', '图片'],
  detail_images: ['详情图', '详情', 'detail_images'],
  sku_specs: ['规格', 'SKU', 'sku', '颜色尺寸', 'spec'],
  description: ['描述', '商品描述', '卖点', 'description', 'desc'],
  attrs: ['属性', '商品属性', '材质', 'attrs'],
  brand: ['品牌', 'brand'],
  weight_kg: ['重量', '重量kg', 'weight'],
  logistics_template: ['物流模板', '运费模板', 'logistics_template'],
};
export function referenceField(header: string): string | null {
  const s = header.trim().toLowerCase();
  for (const [std, aliases] of Object.entries(REFERENCE_ALIASES)) {
    if (aliases.some((a) => s === a.toLowerCase() || s.includes(a.toLowerCase()))) return std;
  }
  return null;
}
