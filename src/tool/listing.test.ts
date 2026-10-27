// 上架流程：用假的拼多多页面（脚本化的 PddBridge）跑完整流程，不访问真实网站。
import { describe, expect, it } from 'vitest';
import { listOne, matchAttrLabel, type ListingDeps, type PageKind } from './listing';
import { buildPlan } from './plan';
import { demoPayloads } from './demo';
import { fromExtension } from './import';
import { pngDataUrl } from './testutil';
import { DEFAULT_SETTINGS, type Product, type ToolSettings } from './types';
import type { PddBridge } from './bridge';

interface Call { fn: string; args: Record<string, unknown> }

/** 一个很小的假页面：按调用推进页面状态 */
function fakePage(opts: {
  start: PageKind; afterGoto?: PageKind; candidates?: string[]; cards?: string[]; tableRows?: { idx: number; text: string }[];
  failOn?: Record<string, string>; tail?: string; saveFound?: string; pageError?: string; blockedFor?: number; onProbe?: (n: number, st: { kind: PageKind }) => void; formAfterNext?: boolean; successUrl?: boolean;
}) {
  const st = { kind: opts.start, probes: 0, nexts: 0, url: 'https://mms.pinduoduo.com/goods/category', submitted: false };
  const calls: Call[] = [];
  const bridge: PddBridge = {
    async call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      calls.push({ fn, args });
      if (opts.failOn?.[fn]) throw new Error(opts.failOn[fn]);
      const r = (v: unknown) => v as T;
      switch (fn) {
        case 'probe': {
          st.probes++;
          opts.onProbe?.(st.probes, st);
          if (opts.blockedFor && st.probes <= opts.blockedFor) return r({ url: st.url, kind: 'login', blocked: 'login' });
          return r({ url: st.submitted && opts.successUrl ? 'https://mms.pinduoduo.com/goods/goods_add/success' : st.url, kind: st.kind, blocked: '' });
        }
        case 'gotoCategory': st.kind = opts.afterGoto ?? 'category_search'; return r({ navigating: true });
        case 'searchCategory': return r({ candidates: opts.candidates ?? [] });
        case 'clickNext':
          st.nexts++;
          if (st.kind === 'category_search' || opts.formAfterNext !== false && st.kind === 'step1' && st.nexts >= 2) st.kind = 'form';
          return r({ clicked: true });
        case 'listRecommended': return r({ cards: (st.nexts >= 1 ? opts.cards ?? [] : []).map((text) => ({ text, checked: false })) });
        case 'listAttrs': return r({ labels: ['材质', '适用季节', '风格'] });
        case 'fillAttr': return r({ ok: true });
        case 'specSlots': return r({ used: 0, found: true });
        case 'addSpecType': return r({ added: (args.values as string[]).length, total: (args.values as string[]).length });
        case 'readSkuRows': return r({ rows: opts.tableRows ?? [] });
        case 'fillSkuRow': return r({ ok: true });
        case 'imgsAttach': return r({ count: (args.keys as string[]).length });
        case 'fillBrand': return r({ filled: true });
        case 'clickButtonByText': if ((args.texts as string[]).includes('提交并上架')) st.submitted = true; return r({ ok: true, clicked: 'x' });
        case 'waitText': return r({ found: opts.saveFound ?? '保存成功', url: st.url });
        case 'pageErrors': return r({ error: opts.pageError ?? '', tail: '', url: st.url });
        case 'pageTail': return r({ tail: opts.tail ?? '', url: st.url });
        default: return r({ ok: true });
      }
    },
  };
  return { bridge, calls, st };
}

function product(extra: Partial<Product> = {}): Product {
  const base = fromExtension(demoPayloads(pngDataUrl)[0], { titleMax: 30 });
  return { ...base, localMain: ['main/main_01.png', 'main/main_02.png'], status: 'ready', ...extra };
}
const bytes = new Uint8Array(400_000).fill(7); // 超过一个分块大小，会拆成 3 块发送

function deps(page: ReturnType<typeof fakePage>, over: Partial<ListingDeps> = {}, settings: Partial<ToolSettings> = {}) {
  let t = 0;
  const logs: string[] = [];
  const d: ListingDeps = {
    bridge: page.bridge, readImage: async () => bytes, log: (m) => logs.push(m), confirmSubmit: async () => true,
    settings: { ...DEFAULT_SETTINGS, ...settings }, mode: 'draft', sleep: async (ms) => { t += ms; }, now: () => t, userWaitMs: 60_000, ...over,
  };
  return { d, logs };
}
const rowsFor = (p: Product, s = DEFAULT_SETTINGS) => buildPlan(p, s).sku.rows.map((r, i) => ({ idx: i, text: `${r.combo.join(' ')} 库存 拼单价` }));
const names = (c: Call[]) => c.map((x) => x.fn);

describe('类目搜索页 → 填表 → 保存草稿', () => {
  it('路径完全一致：自动选中，传图、标题、品牌、属性、规格、价格都走到，最后只点保存草稿', async () => {
    const p = product({ categoryPath: '家居日用 > 水具 > 保温杯', brand: '示例品牌' });
    const plan = buildPlan(p, DEFAULT_SETTINGS);
    const page = fakePage({ start: 'other', candidates: ['家居日用 > 水具 > 保温杯', '家居日用 > 水具 > 保温壶'], tableRows: rowsFor(p) });
    const { d, logs } = deps(page);
    const r = await listOne(plan, d);
    expect(r).toMatchObject({ ok: true, mode: 'draft', done: true, stage: 'draft' });
    const f = names(page.calls);
    expect(f.indexOf('gotoCategory')).toBeLessThan(f.indexOf('searchCategory'));
    expect(page.calls.find((c) => c.fn === 'pickCategory')?.args.text).toBe('家居日用 > 水具 > 保温杯');
    expect(page.calls.find((c) => c.fn === 'searchCategory')?.args.keyword).toBe('保温杯');
    expect(page.calls.find((c) => c.fn === 'fillTitle')?.args.title).toBe(plan.title);
    expect(f.filter((x) => x === 'addSpecType')).toHaveLength(2);
    expect(f.filter((x) => x === 'fillSkuRow')).toHaveLength(4);
    expect(f.filter((x) => x === 'imgBegin')).toHaveLength(2);
    expect(f.filter((x) => x === 'imgChunk')).toHaveLength(6);
    expect(f.filter((x) => x === 'imgsAttach')).toHaveLength(1);
    expect(page.calls.filter((c) => c.fn === 'fillAttr').map((c) => c.args.label)).toEqual(['材质']);
    expect(page.calls.find((c) => c.fn === 'chooseText')?.args.text).toBe('48小时发货及揽收');
    expect(page.calls.filter((c) => c.fn === 'tickCheckbox').map((c) => c.args.text)).toEqual(['每单必开']);
    const clicks = page.calls.filter((c) => c.fn === 'clickButtonByText').map((c) => c.args.texts);
    expect(clicks).toEqual([['保存草稿', '存草稿']]);
    expect(logs.join('\n')).toContain('草稿已保存');
  });
  it('每个规格值 + 价格库存按设置填：库存、拼单价、单买价', async () => {
    const p = product();
    const page = fakePage({ start: 'category_search', candidates: ['家居 > 保温杯'], tableRows: rowsFor(p) });
    await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page).d);
    const first = page.calls.find((c) => c.fn === 'fillSkuRow')!.args;
    expect(first).toMatchObject({ idx: 0, stock: 100, group: 27.75, single: 34.23 });
  });
  it('勾选承诺默认不勾；设置里勾了才勾', async () => {
    const p = product();
    const mk = () => fakePage({ start: 'category_search', candidates: ['a > b'], tableRows: rowsFor(p) });
    const a = mk();
    await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(a).d);
    expect(a.calls.filter((c) => c.fn === 'tickCheckbox')).toHaveLength(1);
    const s = { ...DEFAULT_SETTINGS, promises: ['正品发票', '假一赔十'] };
    const b = mk();
    await listOne(buildPlan(p, s), deps(b, {}, s).d);
    expect(b.calls.filter((c) => c.fn === 'tickCheckbox').map((c) => c.args.text)).toEqual(['正品发票', '假一赔十', '每单必开']);
  });
  it('候选很多又没有完全一致的：暂停等用户自己选，用户选好（进入表单）后继续', async () => {
    const p = product({ categoryPath: '男装 > T恤 > T恤' });
    const page = fakePage({ start: 'category_search', candidates: ['女装 > T恤 > T恤', '男装 > T恤 > 短袖T恤'], tableRows: rowsFor(p), onProbe: (n, st) => { if (n >= 4) st.kind = 'form'; } });
    const { d, logs } = deps(page);
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), d);
    expect(r.ok).toBe(true);
    expect(names(page.calls)).not.toContain('pickCategory');
    expect(logs.join('\n')).toContain('请在拼多多窗口里自己选好类目');
  });
  it('设置为「自动选最相近的」时直接选', async () => {
    const p = product({ categoryPath: '男装 > T恤 > T恤' });
    const page = fakePage({ start: 'category_search', candidates: ['女装 > T恤 > T恤', '男装 > T恤 > 短袖T恤'], tableRows: rowsFor(p) });
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page, {}, { uncertainCategory: 'best' }).d);
    expect(r.ok).toBe(true);
    expect(page.calls.find((c) => c.fn === 'pickCategory')?.args.text).toBe('男装 > T恤 > 短袖T恤');
  });
  it('用户一直没选：超时后这件商品失败，不会乱选', async () => {
    const p = product();
    const page = fakePage({ start: 'category_search', candidates: ['a > b', 'a > c'], tableRows: rowsFor(p) });
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page, { userWaitMs: 10_000 }).d);
    expect(r).toMatchObject({ ok: false, stage: 'category' });
    expect(r.error).toContain('还没选好类目');
    expect(names(page.calls)).not.toContain('pickCategory');
  });
});

describe('新版第一步（先传图和标题）', () => {
  it('图片只传一次；推荐类目按路径选；再点下一步进表单', async () => {
    const p = product({ categoryPath: '家居日用 > 水具 > 保温杯' });
    const page = fakePage({ start: 'step1', cards: ['家居日用 > 水具 > 保温壶', '家居日用 > 水具 > 保温杯'], tableRows: rowsFor(p) });
    page.st.kind = 'step1';
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page).d);
    expect(r.ok).toBe(true);
    const f = names(page.calls);
    expect(f.filter((x) => x === 'imgsAttach')).toHaveLength(1);
    expect(page.calls.find((c) => c.fn === 'clickRecommended')?.args.index).toBe(1);
    expect(f.filter((x) => x === 'clickNext')).toHaveLength(2);
  });
  it('没有推荐类目时暂停等用户', async () => {
    const p = product();
    const page = fakePage({ start: 'step1', cards: [], tableRows: rowsFor(p), onProbe: (n, st) => { if (n >= 45) st.kind = 'form'; } });
    const { d, logs } = deps(page);
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), d);
    expect(r.ok).toBe(true);
    expect(logs.join('\n')).toContain('拼多多没有推荐类目');
  });
});

describe('登录、验证、错误', () => {
  it('需要登录：不继续操作，提示用户自己登录，登录后自动继续', async () => {
    const p = product();
    const page = fakePage({ start: 'category_search', candidates: ['a > b'], tableRows: rowsFor(p), blockedFor: 3 });
    const { d, logs } = deps(page);
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), d);
    expect(r.ok).toBe(true);
    expect(logs.join('\n')).toContain('请在拼多多窗口里自己登录');
    expect(names(page.calls).indexOf('probe')).toBe(0);
  });
  it('一直没登录：超时失败', async () => {
    const p = product();
    const page = fakePage({ start: 'category_search', blockedFor: 9999 });
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page, { userWaitMs: 8000 }).d);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('登录或验证');
  });
  it('上架前检查没通过（没有主图）：不碰页面', async () => {
    const p = product({ localMain: [] });
    const page = fakePage({ start: 'form' });
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page).d);
    expect(r).toMatchObject({ ok: false, stage: 'start' });
    expect(r.error).toContain('没有已下载的主图');
    expect(page.calls).toHaveLength(0);
  });
  it('点了下一步一直进不了表单，页面出现资质提示：给出类目准入的原因', async () => {
    const p = product();
    const page = fakePage({ start: 'category_search', candidates: ['a > b'], tail: '该类目需要提交经营许可资质' });
    page.bridge.call = ((orig) => async <T>(fn: string, args: Record<string, unknown> = {}) => { const v = await orig<T>(fn, args); if (fn === 'clickNext') page.st.kind = 'category_search'; return v; })(page.bridge.call.bind(page.bridge));
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page).d);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('类目准入受限');
    expect(r.error).toContain('经营许可');
  });
  it('保存后页面提示错误：失败并带上页面原话', async () => {
    const p = product();
    const page = fakePage({ start: 'category_search', candidates: ['a > b'], tableRows: rowsFor(p), pageError: '错误项未处理：请填写商品属性' });
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page).d);
    expect(r).toMatchObject({ ok: false, stage: 'draft' });
    expect(r.error).toContain('请填写商品属性');
  });
  it('没有读到保存成功提示：仍算已点保存，但提醒去草稿箱核对', async () => {
    const p = product();
    const page = fakePage({ start: 'category_search', candidates: ['a > b'], tableRows: rowsFor(p), saveFound: '' });
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page).d);
    expect(r.ok).toBe(true);
    expect(r.note).toContain('草稿箱核对');
  });
  it('价格表读不到：失败', async () => {
    const p = product();
    const page = fakePage({ start: 'category_search', candidates: ['a > b'], tableRows: [] });
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page).d);
    expect(r).toMatchObject({ ok: false, stage: 'sku' });
  });
  it('用户中途停止', async () => {
    const p = product();
    const ac = new AbortController();
    const page = fakePage({ start: 'category_search', candidates: ['a > b'], tableRows: rowsFor(p) });
    const orig = page.bridge.call.bind(page.bridge);
    page.bridge.call = async <T>(fn: string, args?: Record<string, unknown>) => { if (fn === 'fillTitle') ac.abort(); return orig<T>(fn, args); };
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page, { signal: ac.signal }).d);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('已取消');
  });
});

describe('提交上架：默认关闭，打开后每次都要确认', () => {
  const mk = () => { const p = product(); return { p, page: fakePage({ start: 'category_search', candidates: ['a > b'], tableRows: rowsFor(p), successUrl: true }) }; };
  it('设置没打开时，提交模式直接拒绝，页面一点都不动', async () => {
    const { p, page } = mk();
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page, { mode: 'submit' }).d);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('没有打开「允许提交上架」');
    expect(page.calls).toHaveLength(0);
  });
  it('打开了但用户在确认框里取消：不点提交', async () => {
    const { p, page } = mk();
    let asked = 0;
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page, { mode: 'submit', confirmSubmit: async () => { asked++; return false; } }, { allowSubmit: true }).d);
    expect(asked).toBe(1);
    expect(r).toMatchObject({ ok: true, done: false, stage: 'submit' });
    expect(page.calls.some((c) => (c.args.texts as string[] | undefined)?.includes('提交并上架'))).toBe(false);
  });
  it('打开且用户确认：点提交并等到成功页', async () => {
    const { p, page } = mk();
    const r = await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page, { mode: 'submit' }, { allowSubmit: true }).d);
    expect(r).toMatchObject({ ok: true, done: true, stage: 'submit', note: '已提交上架' });
    expect(page.calls.some((c) => (c.args.texts as string[] | undefined)?.includes('保存草稿'))).toBe(false);
  });
  it('保存草稿模式从不点提交，即使设置里允许提交', async () => {
    const { p, page } = mk();
    await listOne(buildPlan(p, DEFAULT_SETTINGS), deps(page, { mode: 'draft' }, { allowSubmit: true }).d);
    expect(page.calls.some((c) => (c.args.texts as string[] | undefined)?.includes('提交并上架'))).toBe(false);
  });
});

describe('属性名匹配', () => {
  it('页面属性名包含你写的，或你写的包含页面上的', () => {
    expect(matchAttrLabel('材质', ['材质', '风格'])).toBe('材质');
    expect(matchAttrLabel('主要材质', ['材质', '风格'])).toBe('材质');
    expect(matchAttrLabel('适用季', ['适用季节'])).toBe('适用季节');
    expect(matchAttrLabel('产地', ['材质'])).toBe('');
  });
});
