// 类目匹配：只有「>」是层级分隔符，「/」是节点名字的一部分（如「文具电教/文化用品/商务用品」是一个节点）。
// 规则移植自参考实现的类目选择：段级对齐、最长共同前缀优先、末段包含分。

export function normalizePath(path: string): string[] {
  if (!path) return [];
  return path.trim().split(/\s*[>＞]\s*/).map((p) => p.trim()).filter(Boolean);
}

/** [共同前缀段数, 末段相似分, 总段数差]：前两项越大越好，第三项越小越好 */
export function pathSimilarity(table: string, candidate: string): [number, number, number] {
  const a = normalizePath(table);
  const b = normalizePath(candidate);
  if (!a.length || !b.length) return [0, 0, 999];
  let common = 0;
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) common++;
  const la = a[a.length - 1].toLowerCase();
  const lb = b[b.length - 1].toLowerCase();
  let end: number;
  if (la === lb) end = 100;
  else if (la.includes(lb) || lb.includes(la)) end = 50;
  else end = new Set([...la].filter((c) => lb.includes(c))).size;
  return [common, end, Math.abs(a.length - b.length)];
}

/** 候选里与目标路径逐段完全相同的那一项，没有返回空串 */
export function exactMatch(table: string, candidates: string[]): string {
  const want = normalizePath(table).join(' > ');
  return candidates.find((c) => normalizePath(c).join(' > ') === want) ?? '';
}

/** 按相似度从高到低排候选；同分保持拼多多返回的顺序（相关度高的在前） */
export function rankCandidates(table: string, candidates: string[]): string[] {
  return candidates
    .map((c, i) => ({ c, i, s: pathSimilarity(table, c) }))
    .sort((x, y) => y.s[0] - x.s[0] || y.s[1] - x.s[1] || x.s[2] - y.s[2] || x.i - y.i)
    .map((x) => x.c);
}

export type CategoryDecision =
  | { kind: 'pick'; text: string; why: 'exact' | 'only' | 'best' }
  | { kind: 'ask'; ranked: string[]; reason: string };

/**
 * 决定点哪个候选类目：
 * - 填了类目路径且有逐段完全相同的 → 点它；
 * - 只有一个候选 → 点它；
 * - 其余：设置为「选最相近的」才自动选，默认暂停让用户自己在窗口里选。
 */
export function decideCategory(target: string, candidates: string[], mode: 'pause' | 'best'): CategoryDecision {
  if (!candidates.length) return { kind: 'ask', ranked: [], reason: '拼多多没有返回任何候选类目' };
  if (target) {
    const hit = exactMatch(target, candidates);
    if (hit) return { kind: 'pick', text: hit, why: 'exact' };
  }
  if (candidates.length === 1) return { kind: 'pick', text: candidates[0], why: 'only' };
  const ranked = target ? rankCandidates(target, candidates) : candidates;
  if (mode === 'best') return { kind: 'pick', text: ranked[0], why: 'best' };
  return { kind: 'ask', ranked, reason: target ? `没有和「${target}」完全相同的类目（共 ${candidates.length} 个候选）` : `找到 ${candidates.length} 个候选，无法唯一确定` };
}
