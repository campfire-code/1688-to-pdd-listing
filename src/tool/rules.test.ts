// 纯规则：标题清洗、类目匹配、规格组合、定价、导入映射。
import { describe, expect, it } from 'vitest';
import { categoryKeyword, cleanTitle, clampChars, normalizeText } from './clean';
import { decideCategory, exactMatch, normalizePath, pathSimilarity, rankCandidates } from './category';
import { fromExtension, mergeRecollect, minPrice, normalizeImageUrls, offerIdFromUrl, parseAttrKv, parseAttrLines, platformFromUrl } from './import';
import { priceFromCost } from './pricing';
import { buildSkuPlan, locateRows, splitSkuName } from './sku';
import { buildPlan } from './plan';
import { DEFAULT_SETTINGS, type Product } from './types';

const S = DEFAULT_SETTINGS;

describe('标题清洗', () => {
  it('去掉批发词、表情和装饰符号，合并空白', () => {
    expect(cleanTitle('【爆款】厂家直销 304不锈钢保温杯🔥 一件代发', 30)).toBe('304不锈钢保温杯');
  });
  it('全角字符转半角', () => {
    expect(normalizeText('ＡＢＣ１２３　测试')).toBe('ABC123 测试');
  });
  it('按字数截断，不拆开表情等多字节字符', () => {
    expect(clampChars('一二三四五六七八九十', 5)).toBe('一二三四五');
    expect(Array.from(clampChars('𠮷𠮷𠮷𠮷', 2)).length).toBe(2);
  });
  it('清洗后为空时退回规范化的原标题', () => {
    expect(cleanTitle('批发', 30)).toBe('批发');
  });
  it('类目关键词：优先属性里的品类，其次标题最后一个汉字词', () => {
    expect(categoryKeyword('厂家直销 0.5mm 中性笔 黑色 学生用品 批发', {})).toBe('学生用品');
    expect(categoryKeyword('随便', { 产品类型: '保温杯' })).toBe('保温杯');
    expect(categoryKeyword('A1 B2', {})).toBe('A1 B2');
  });
});

describe('类目匹配', () => {
  const cands = ['男装 > T恤 > 短袖T恤', '男装 > T恤 > T恤', '女装 > T恤 > T恤'];
  it('只有「>」分层，「/」属于节点名', () => {
    expect(normalizePath('文具电教/文化用品/商务用品 > 笔类/书写工具 > 中性笔')).toEqual(['文具电教/文化用品/商务用品', '笔类/书写工具', '中性笔']);
    expect(normalizePath('')).toEqual([]);
  });
  it('相似度：前缀段数、末段分、段数差', () => {
    expect(pathSimilarity('男装 > T恤 > T恤', '男装 > T恤 > T恤')).toEqual([3, 100, 0]);
    expect(pathSimilarity('男装 > T恤 > T恤', '男装 > T恤 > 短袖T恤')).toEqual([2, 50, 0]);
    expect(pathSimilarity('', 'x')).toEqual([0, 0, 999]);
  });
  it('逐段完全相同才算精确匹配', () => {
    expect(exactMatch('男装>T恤>T恤', cands)).toBe('男装 > T恤 > T恤');
    expect(exactMatch('男装 > T恤', cands)).toBe('');
  });
  it('排序：共同前缀长的在前，同分保持原顺序', () => {
    expect(rankCandidates('男装 > T恤 > T恤', cands)[0]).toBe('男装 > T恤 > T恤');
    expect(rankCandidates('男装 > 卫衣 > 圆领卫衣', cands)[2]).toBe('女装 > T恤 > T恤');
  });
  it('决策：精确匹配直接选；唯一候选直接选；多候选默认暂停', () => {
    expect(decideCategory('男装 > T恤 > T恤', cands, 'pause')).toEqual({ kind: 'pick', text: '男装 > T恤 > T恤', why: 'exact' });
    expect(decideCategory('', ['a > b'], 'pause')).toEqual({ kind: 'pick', text: 'a > b', why: 'only' });
    const d = decideCategory('', cands, 'pause');
    expect(d.kind).toBe('ask');
    expect(decideCategory('男装 > T恤 > 圆领T恤', cands, 'pause').kind).toBe('ask');
    expect(decideCategory('男装 > T恤 > 圆领T恤', cands, 'best')).toMatchObject({ kind: 'pick', why: 'best' });
    expect(decideCategory('x', [], 'best').kind).toBe('ask');
  });
});

describe('定价', () => {
  it('拼单价、单买价 = 进价 × 系数，保留两位', () => {
    expect(priceFromCost(18.5, S)).toEqual({ group: 27.75, single: 34.23 });
  });
  it('单买价不高于拼单价时，按拼单价上浮 15%', () => {
    expect(priceFromCost(10, { groupMultiplier: 2, singleMultiplier: 1.5 })).toEqual({ group: 20, single: 23 });
  });
});

describe('规格组合', () => {
  it('拆规格名：>、+、全角、&gt;', () => {
    expect(splitSkuName('红色 > S')).toEqual(['红色', 'S']);
    expect(splitSkuName('【子弹头】黑色 + 100 支笔')).toEqual(['【子弹头】黑色', '100 支笔']);
    expect(splitSkuName('红色＞S')).toEqual(['红色', 'S']);
    expect(splitSkuName('红色 &gt; S')).toEqual(['红色', 'S']);
    expect(splitSkuName('M/L')).toEqual(['M/L']);
  });
  const two = { cost: 15.8, skus: [
    { name: '白色 > M', purchasePrice: 15.8 }, { name: '白色 > L', purchasePrice: 15.8 },
    { name: '黑色 > M', purchasePrice: 16.8 }, { name: '黑色 > XL', purchasePrice: 17.8 },
  ] };
  it('两层规格：两个规格类型，值去重；1688 里没有的组合补库存 0', () => {
    const p = buildSkuPlan(two, S);
    expect(p.specs).toEqual([{ name: '款式', values: ['白色', '黑色'] }, { name: '尺寸', values: ['M', 'L', 'XL'] }]);
    expect(p.rows).toHaveLength(6);
    const fillers = p.rows.filter((r) => r.filler);
    expect(fillers.map((r) => r.combo.join('+'))).toEqual(['白色+XL', '黑色+L']);
    expect(fillers.every((r) => r.stock === 0)).toBe(true);
    expect(p.rows[0]).toMatchObject({ combo: ['白色', 'M'], group: 23.7, single: 29.23, stock: 100 });
    expect(p.warnings.join()).toContain('2 个规格组合在 1688 里不存在');
  });
  it('单层规格：一个规格类型', () => {
    const p = buildSkuPlan({ cost: 5, skus: [{ name: '红', purchasePrice: 5 }, { name: '蓝', purchasePrice: 6 }] }, S);
    expect(p.specs).toEqual([{ name: '款式', values: ['红', '蓝'] }]);
    expect(p.rows.map((r) => r.combo)).toEqual([['红'], ['蓝']]);
  });
  it('只有「默认」规格，或没有规格：不建规格类型', () => {
    expect(buildSkuPlan({ cost: 4.2, skus: [{ name: '默认', purchasePrice: 4.2 }] }, S).specs).toEqual([]);
    const none = buildSkuPlan({ cost: 4.2, skus: [] }, S);
    expect(none.rows).toHaveLength(1);
    expect(none.rows[0]).toMatchObject({ combo: [], group: 6.3, single: 7.77 });
  });
  it('规格价格是 0 时用商品进价；都没有则提醒', () => {
    const p = buildSkuPlan({ cost: 9, skus: [{ name: '红', purchasePrice: 0 }, { name: '蓝', purchasePrice: 0 }] }, S);
    expect(p.rows[0].cost).toBe(9);
    expect(buildSkuPlan({ cost: null, skus: [] }, S).warnings.join()).toContain('没有读到进价');
  });
  it('三层规格：多出来的层级合并进第二个规格类型', () => {
    const p = buildSkuPlan({ cost: 1, skus: [{ name: '红 > 大 > 加厚', purchasePrice: 1 }] }, S);
    expect(p.specs[1].values).toEqual(['大 加厚']);
    expect(p.warnings.join()).toContain('超过 2 层');
  });
  it('规格超过 50 个时提醒', () => {
    const skus = Array.from({ length: 60 }, (_, i) => ({ name: `款${i}`, purchasePrice: 1 }));
    expect(buildSkuPlan({ cost: 1, skus }, S).warnings.join()).toContain('超过 50');
  });
  it('规格类型名可以改', () => {
    const p = buildSkuPlan(two, { ...S, specTypeNames: ['颜色', '尺码'] });
    expect(p.specs.map((x) => x.name)).toEqual(['颜色', '尺码']);
  });
  it('对应页面表格行：按文字；第一列合并单元格时按位置', () => {
    const plan = buildSkuPlan(two, S);
    const textRows = plan.rows.map((r, i) => ({ idx: i, text: r.combo.join(' ') + ' 库存 拼单价' }));
    expect(locateRows(textRows, plan.specs, plan.rows)).toEqual([0, 1, 2, 3, 4, 5]);
    // 第一列合并：每组只有第一行有「白色」「黑色」
    const merged = [
      { idx: 0, text: '白色 M' }, { idx: 1, text: 'L' }, { idx: 2, text: 'XL' },
      { idx: 3, text: '黑色 M' }, { idx: 4, text: 'L' }, { idx: 5, text: 'XL' },
    ];
    const where = locateRows(merged, plan.specs, plan.rows);
    expect(where[plan.rows.findIndex((r) => r.combo.join() === '白色,XL')]).toBe(2);
    expect(where[plan.rows.findIndex((r) => r.combo.join() === '黑色,L')]).toBe(4);
    expect(new Set(where).size).toBe(6);
  });
  it('整词优先：S 不会错配到 XS 那一行', () => {
    const specs = [{ name: '款式', values: ['红'] }, { name: '尺寸', values: ['XS', 'S'] }];
    const rows = [{ combo: ['红', 'S'], stock: 1, group: 1, single: 1, cost: 1 }];
    expect(locateRows([{ idx: 0, text: '红 XS' }, { idx: 1, text: '红 S' }], specs, rows)).toEqual([1]);
  });
});

describe('导入映射', () => {
  it('来源编号：1688 用 offer 号，淘宝天猫加 tb_ 前缀', () => {
    expect(offerIdFromUrl('https://detail.1688.com/offer/963244702031.html?x=1')).toBe('963244702031');
    expect(offerIdFromUrl('https://item.taobao.com/item.htm?id=2000&spm=a')).toBe('tb_2000');
    expect(offerIdFromUrl('https://detail.tmall.com/item.htm?spm=x&id=77')).toBe('tb_77');
    expect(offerIdFromUrl('')).toBe('');
  });
  it('平台：按域名，插件给的 platform 优先（淘宝 / 天猫）', () => {
    expect(platformFromUrl('https://detail.1688.com/offer/1.html')).toBe('1688');
    expect(platformFromUrl('https://detail.tmall.com/item.htm?id=1', 'tmall')).toBe('tmall');
    expect(platformFromUrl('https://example.com/x')).toBe('other');
  });
  it('描述里的属性行，支持中英文冒号', () => {
    expect(parseAttrLines('材质: PP塑料\n品牌：无品牌\n没有冒号\n空值:')).toEqual({ 材质: 'PP塑料', 品牌: '无品牌' });
    expect(parseAttrKv('材质:棉；颜色：红\n尺寸:M')).toEqual({ 材质: '棉', 颜色: '红', 尺寸: 'M' });
  });
  it('进价取各规格最低的正数价格', () => {
    expect(minPrice([{ name: 'a', purchasePrice: 0 }, { name: 'b', purchasePrice: 9.9 }, { name: 'c', purchasePrice: 5 }])).toBe(5);
    expect(minPrice([], '12.5')).toBe(12.5);
    expect(minPrice([])).toBeNull();
  });
  it('图片地址：补协议、去重（忽略参数）、去 gif 和非图片、可排除主图', () => {
    const out = normalizeImageUrls(['//a.com/1.jpg?x=1', 'https://a.com/1.jpg?y=2', 'https://a.com/2.gif', 'ftp://a.com/3.jpg', 'data:image/png;base64,AAAA', 5, ' https://a.com/4.png '], 30);
    expect(out).toEqual(['https://a.com/1.jpg?x=1', 'data:image/png;base64,AAAA', 'https://a.com/4.png']);
    expect(normalizeImageUrls(['https://a.com/1.jpg'], 30, new Set(['https://a.com/1.jpg']))).toEqual([]);
  });
  const payload = { productName: ' 示例·保温杯 批发 ', description: '材质: 钢', images: ['https://a.com/m1.jpg'], detailImages: ['https://a.com/m1.jpg', 'https://a.com/d1.jpg'], skuList: [{ name: '黑', purchasePrice: 10 }, { name: '', purchasePrice: 1 }], sourceUrl: 'https://detail.1688.com/offer/55.html', weight_g: 380 };
  it('插件 JSON → 商品：清洗标题、重量换算、详情图去掉和主图重复的', () => {
    const p = fromExtension(payload, { titleMax: 30, now: 1 });
    expect(p).toMatchObject({ id: '55', platform: '1688', title: '示例·保温杯 批发', cleanTitle: '示例·保温杯', cost: 10, weightKg: 0.38, status: 'collected' });
    expect(p.detailImages).toEqual(['https://a.com/d1.jpg']);
    expect(p.skus).toHaveLength(1);
    expect(p.attrs).toEqual({ 材质: '钢' });
  });
  it('没有链接时用标题生成编号', () => {
    expect(fromExtension({ productName: '示例 杯子' }, { titleMax: 30 }).id).toBe('noid_示例_杯子');
  });
  it('重复采集：更新来源数据，保留类目、备注、品牌和手改的标题', () => {
    const old: Product = { ...fromExtension(payload, { titleMax: 30, now: 1 }), cleanTitle: '我改的标题', categoryPath: '家居 > 水杯', note: '重点', brand: '甲', status: 'drafted', localMain: ['main/main_01.jpg'] };
    const fresh = fromExtension({ ...payload, skuList: [{ name: '黑', purchasePrice: 11 }] }, { titleMax: 30, now: 2 });
    const m = mergeRecollect(old, fresh, 30);
    expect(m).toMatchObject({ cleanTitle: '我改的标题', categoryPath: '家居 > 水杯', note: '重点', brand: '甲', cost: 11, status: 'drafted', collectedAt: 1, updatedAt: 2 });
    expect(m.localMain).toEqual(['main/main_01.jpg']);
    const changed = mergeRecollect(old, { ...fresh, mainImages: ['https://a.com/new.jpg'] }, 30);
    expect(changed.localMain).toEqual([]);
    expect(changed.status).toBe('collected');
  });
});

describe('上架方案', () => {
  const base = { ...fromExtension({ productName: '示例 杯子', skuList: [{ name: '黑', purchasePrice: 10 }, { name: '白', purchasePrice: 10 }], sourceUrl: 'https://detail.1688.com/offer/9.html', description: '品牌: 示例品牌\n材质: 钢' }, { titleMax: 30 }) };
  it('没有主图、没有进价都是不能上架的问题', () => {
    expect(buildPlan(base, S).blockers).toEqual(['没有已下载的主图（先在产品库里「下载图片」）']);
    expect(buildPlan({ ...base, cost: null, skus: [] }, S).blockers.join()).toContain('缺少进价');
  });
  it('品牌从属性里提出来；主图最多 10 张；已存过草稿提醒', () => {
    const p = { ...base, localMain: Array.from({ length: 12 }, (_, i) => `main/main_${i}.jpg`), status: 'drafted' as const };
    const plan = buildPlan(p, S);
    expect(plan.blockers).toEqual([]);
    expect(plan.brand).toBe('示例品牌');
    expect(plan.attrs).toEqual({ 材质: '钢' });
    expect(plan.images).toHaveLength(10);
    expect(plan.warnings.join()).toContain('只传前 10 张');
    expect(plan.warnings.join()).toContain('已经保存过草稿');
  });
  it('类目关键词：填了路径取最后一段，否则从标题里取', () => {
    expect(buildPlan({ ...base, categoryPath: '男装 > T恤 > T恤' }, S).keyword).toBe('T恤');
    expect(buildPlan(base, S).keyword).toBe('杯子');
  });
});
