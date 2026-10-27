// 定价：拼单价、单买价都由进价乘系数得到（系数在设置里改，默认沿用参考实现的 1.5 和 1.85）。
import type { ToolSettings } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;

export function priceFromCost(cost: number, s: Pick<ToolSettings, 'groupMultiplier' | 'singleMultiplier'>): { group: number; single: number } {
  const group = r2(cost * s.groupMultiplier);
  let single = r2(cost * s.singleMultiplier);
  // 拼多多要求单买价高于拼单价（参考实现的注释）；系数设得不合适时，单买价按拼单价上浮 15%
  if (single <= group) single = r2(group * 1.15);
  return { group, single };
}

export const validCost = (c: unknown): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0;
