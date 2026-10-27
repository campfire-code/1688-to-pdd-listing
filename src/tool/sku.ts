// 规格组合：把 1688 / 淘宝页面读出来的规格行，整理成拼多多「规格类型（最多 2 个）+ 规格值」和每个组合的价格库存。
import type { ExtSku, Product, ToolSettings } from './types';
import { priceFromCost, validCost } from './pricing';

/** 拼多多一件商品最多 2 个规格类型（页面按钮显示「添加规格类型(0/2)」） */
export const MAX_SPEC_TYPES = 2;
/** 规格行超过这个数时提醒分批（沿用参考插件的提示，未核实平台上限，以平台为准） */
export const SKU_WARN_COUNT = 50;

export interface SpecType { name: string; values: string[] }
export interface SkuRow {
  /** 每个规格类型对应的值，顺序和 SpecType 一致 */
  combo: string[];
  stock: number;
  group: number;
  single: number;
  cost: number;
  /** 这一行没有对应的 1688 规格（拼多多按规格值做笛卡尔积生成的多余行） */
  filler?: boolean;
}
export interface SkuPlan { specs: SpecType[]; rows: SkuRow[]; warnings: string[] }

/** 规格名里的层级分隔：「红色 > S」「红色 + S」「红色＞S」 */
export function splitSkuName(name: string): string[] {
  return (name ?? '')
    .replace(/&gt;/gi, '>')
    .split(/\s*(?:>|＞|\+|＋)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const isDefaultName = (n: string) => /^(默认|默认规格|默认款|标准|SKU-?\d*)$/i.test(n.trim());

export function buildSkuPlan(p: Pick<Product, 'skus' | 'cost'>, s: ToolSettings): SkuPlan {
  const warnings: string[] = [];
  const skus = p.skus.filter((x) => x && x.name);
  const baseCost = validCost(p.cost) ? p.cost : null;
  const costOf = (x: ExtSku) => (Number(x.purchasePrice) > 0 ? Number(x.purchasePrice) : baseCost);

  // 没有规格，或只有一个「默认」规格：按单规格商品处理，不建规格类型
  if (skus.length === 0 || (skus.length === 1 && isDefaultName(skus[0].name))) {
    if (baseCost === null) warnings.push('没有读到进价，请在产品库里补上');
    const { group, single } = priceFromCost(baseCost ?? 0, s);
    return { specs: [], rows: [{ combo: [], stock: s.defaultStock, group, single, cost: baseCost ?? 0 }], warnings };
  }

  const parts = skus.map((x) => splitSkuName(x.name));
  const depth = Math.min(MAX_SPEC_TYPES, Math.max(...parts.map((a) => a.length)));
  if (Math.max(...parts.map((a) => a.length)) > MAX_SPEC_TYPES) warnings.push(`规格层级超过 ${MAX_SPEC_TYPES} 层，多出来的层级已合并到第二个规格类型里`);

  const specs: SpecType[] = Array.from({ length: depth }, (_, i) => ({ name: s.specTypeNames[i], values: [] }));
  const rows: SkuRow[] = [];
  const seenCombo = new Set<string>();
  skus.forEach((x, idx) => {
    const a = parts[idx];
    const combo = depth === 1 ? [a.join(' ')] : [a[0] ?? '', a.slice(1).join(' ')];
    if (combo.some((c) => !c)) {
      warnings.push(`规格「${x.name}」层级不全，已跳过`);
      return;
    }
    const key = combo.join('\u0001');
    if (seenCombo.has(key)) return;
    seenCombo.add(key);
    combo.forEach((v, i) => { if (!specs[i].values.includes(v)) specs[i].values.push(v); });
    const cost = costOf(x);
    if (cost === null) warnings.push(`规格「${x.name}」没有价格`);
    const { group, single } = priceFromCost(cost ?? 0, s);
    rows.push({ combo, stock: s.defaultStock, group, single, cost: cost ?? 0 });
  });

  if (depth === 2) {
    // 拼多多会把两个规格类型的值做笛卡尔积；1688 里没有的组合，补成库存 0，避免卖出不存在的款
    const cheapest = rows.length ? rows.reduce((m, r) => (r.cost > 0 && (m.cost === 0 || r.cost < m.cost) ? r : m), rows[0]) : null;
    let fillers = 0;
    for (const v1 of specs[0].values) {
      for (const v2 of specs[1].values) {
        if (seenCombo.has([v1, v2].join('\u0001'))) continue;
        fillers++;
        rows.push({ combo: [v1, v2], stock: 0, group: cheapest?.group ?? 0, single: cheapest?.single ?? 0, cost: cheapest?.cost ?? 0, filler: true });
      }
    }
    if (fillers) warnings.push(`有 ${fillers} 个规格组合在 1688 里不存在，已设为库存 0`);
  }
  if (rows.length > SKU_WARN_COUNT) warnings.push(`规格组合有 ${rows.length} 个，超过 ${SKU_WARN_COUNT}，建议分批上架（未核实平台上限，以平台为准）`);
  return { specs, rows, warnings };
}

/**
 * 把每个规格组合对应到页面价格表的哪一行。
 * 先按文字找（整词相等优先，其次包含）；找不到时，如果表的行数正好等于规格值个数的乘积，按「第一个规格值为外层、第二个为内层」的顺序按位置对应
 * （拼多多的表格可能把第一列合并单元格，后面几行读不到第一个规格值）。
 * 返回与 rows 等长的数组，找不到的位置是 -1。
 */
export function locateRows(tableRows: { idx: number; text: string }[], specs: SpecType[], rows: SkuRow[]): number[] {
  const used = new Set<number>();
  const out = rows.map(() => -1);
  const tokens = tableRows.map((r) => r.text.split(/\s+/));
  const pass = (loose: boolean) => {
    rows.forEach((row, i) => {
      if (out[i] >= 0 || !row.combo.length) return;
      const hit = tableRows.findIndex((r, k) => !used.has(r.idx) && row.combo.every((c) => (loose ? r.text.includes(c) : tokens[k].includes(c))));
      if (hit >= 0) { out[i] = tableRows[hit].idx; used.add(tableRows[hit].idx); }
    });
  };
  pass(false);
  pass(true);
  const total = specs.reduce((n, sp) => n * sp.values.length, 1);
  if (specs.length && tableRows.length === total) {
    rows.forEach((row, i) => {
      if (out[i] >= 0) return;
      let pos = 0;
      row.combo.forEach((v, k) => {
        const inner = specs.slice(k + 1).reduce((n, sp) => n * sp.values.length, 1);
        pos += specs[k].values.indexOf(v) * inner;
      });
      const idx = tableRows[pos]?.idx;
      if (idx !== undefined && !used.has(idx)) { out[i] = idx; used.add(idx); }
    });
  }
  return out;
}
