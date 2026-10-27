// 标题清洗与类目关键词。纯函数。
// 1688 标题是写给批发买家的，上架到拼多多零售前要去掉批发、代发、厂家这类词，并控制字数。

/** 批发语境里常见、零售标题不需要的词（沿用参考实现的清单，可在这里增删） */
export const WHOLESALE_WORDS = [
  '一件代发', '批发', '代发', '厂家直销', '厂家', '源头', '直销', '现货', '工厂', '包邮',
  '全网', '热销', '精品', '实拍', '爆款', '促销', '特价', '高品质', '优质', '精选', '新款', '新品', '正品',
];

/** 全角转半角、去掉表情符号和装饰符号、合并空白 */
export function normalizeText(s: string): string {
  return (s ?? '')
    .normalize('NFKC')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[【】\[\]「」『』《》<>★☆●○◆◇■□▲△※~～|｜]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const chars = (s: string) => Array.from(s);

/** 按字数截断（一个汉字、字母、数字都算一个），不会把表情等拆成乱码 */
export function clampChars(s: string, max: number): string {
  const a = chars(s);
  return a.length <= max ? s : a.slice(0, max).join('').trim();
}

export function cleanTitle(title: string, max: number): string {
  let t = normalizeText(title);
  for (const w of WHOLESALE_WORDS) t = t.split(w).join(' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) t = normalizeText(title);
  return clampChars(t, max);
}

/** 从标题里挑搜类目用的关键词：去掉营销词后，取最后一个连续的汉字词（通常是品类词，如「中性笔」） */
export function categoryKeyword(title: string, attrs: Record<string, string> = {}): string {
  for (const k of ['产品类型', '品类', '类型', '种类']) {
    const v = (attrs[k] ?? '').trim();
    if (v) return v;
  }
  let t = normalizeText(title);
  for (const w of [...WHOLESALE_WORDS, '礼盒', '通用', '百搭', '适用']) t = t.split(w).join(' ');
  const tokens = t.match(/[一-龥]{2,}/g) ?? [];
  return tokens.length ? tokens[tokens.length - 1] : clampChars(normalizeText(title), 8) || '商品';
}
