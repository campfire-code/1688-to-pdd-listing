// 上架流程：在应用自带的拼多多窗口里，按步骤填表、传主图、保存草稿。
// 页面操作都经过 PddBridge，所以流程本身可以用假通道做测试，不碰真实网站。
// 默认只「保存草稿」；「提交上架」必须在设置里打开，并且每次提交前都要用户确认。
import type { PddBridge } from './bridge';
import { sendImage } from './bridge';
import { decideCategory } from './category';
import type { ListingPlan } from './plan';
import { locateRows } from './sku';
import type { ToolSettings } from './types';

export type PageKind = 'login' | 'captcha' | 'category_search' | 'step1' | 'form' | 'other';
interface Probe { url: string; kind: PageKind; blocked: string }

export interface ListingDeps {
  bridge: PddBridge;
  /** 读取产品文件夹里的一张图（参数是相对路径，如 main/main_01.jpg） */
  readImage(rel: string): Promise<Uint8Array>;
  log(msg: string): void;
  /** 提交上架前的确认；返回 false 就不提交 */
  confirmSubmit(plan: ListingPlan): Promise<boolean>;
  settings: ToolSettings;
  mode: 'draft' | 'submit';
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  /** 等用户自己处理登录、验证、选类目的最长时间 */
  userWaitMs?: number;
}

export interface ListingResult {
  ok: boolean;
  mode: 'draft' | 'submit';
  stage: string;
  /** 草稿已保存 / 已提交；用户取消提交时为 false */
  done: boolean;
  error?: string;
  note?: string;
}

class Stop extends Error {}

/** 属性名模糊匹配：页面上的属性名包含你写的，或你写的包含页面上的（参考实现的规则） */
export function matchAttrLabel(userKey: string, labels: string[]): string {
  return labels.find((l) => userKey.includes(l) || l.includes(userKey)) ?? '';
}

const ACCESS_HINTS = ['资质', '审核', '经营许可', '类目限制', '需要提交', '暂不支持', '无权限'];

export async function listOne(plan: ListingPlan, deps: ListingDeps): Promise<ListingResult> {
  const { bridge, settings: s } = deps;
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const userWait = deps.userWaitMs ?? 10 * 60_000;
  const result = (stage: string, done: boolean, note?: string): ListingResult => ({ ok: true, mode: deps.mode, stage, done, note });
  let stage = 'start';
  let imagesDone = false;

  const check = () => { if (deps.signal?.aborted) throw new Stop('已取消'); };
  const call = async <T>(fn: string, args: Record<string, unknown> = {}, ms?: number): Promise<T> => { check(); return bridge.call<T>(fn, args, ms); };

  /** 读页面状态；页面正在跳转时会失败，当成「还不知道」 */
  const probe = async (): Promise<Probe | null> => {
    try { return await call<Probe>('probe', {}, 8000); } catch (e) { if (e instanceof Stop) throw e; return null; }
  };
  const waitKind = async (kinds: PageKind[], ms: number, msg?: string): Promise<Probe | null> => {
    const end = now() + ms;
    let told = false;
    while (now() < end) {
      const p = await probe();
      if (p && kinds.includes(p.kind)) return p;
      if (p && (p.kind === 'login' || p.kind === 'captcha') && !told) {
        deps.log(p.kind === 'login' ? '需要登录：请在拼多多窗口里自己登录，登录后会自动继续' : '页面出现验证：请在拼多多窗口里自己完成，完成后会自动继续');
        told = true;
      } else if (msg && !told) { deps.log(msg); told = true; }
      await sleep(1500);
    }
    return null;
  };

  const uploadImages = async () => {
    deps.log(`上传主图 ${plan.images.length} 张…`);
    await call('imgsClear');
    const keys: string[] = [];
    for (let i = 0; i < plan.images.length; i++) {
      const rel = plan.images[i];
      const key = `m${i}`;
      await sendImage(bridge, key, rel.split('/').pop() ?? `main_${i}.jpg`, await deps.readImage(rel));
      keys.push(key);
    }
    const r = await call<{ count: number }>('imgsAttach', { keys }, 30000);
    await sleep(4000);
    imagesDone = true;
    deps.log(`已交给页面上传 ${r.count} 张主图`);
  };

  /** 用户在窗口里自己选类目时，等页面进入发布表单 */
  const askUser = async (why: string, ranked: string[]) => {
    deps.log(`${why}。请在拼多多窗口里自己选好类目并点「下一步」，选好后会自动继续。${ranked.length ? '（最接近的：' + ranked.slice(0, 3).join('；') + '）' : ''}`);
    const p = await waitKind(['form'], userWait);
    if (!p) throw new Error('等了很久你还没选好类目，这件商品先跳过');
  };

  const enterForm = async () => {
    stage = 'category';
    let p = await probe();
    // 每件商品都从类目页重新开始，避免把上一件商品的表单当成这一件的
    if (!p || p.kind === 'other' || p.kind === 'form') {
      deps.log('打开类目选择页…');
      await call('gotoCategory').catch(() => undefined);
      await sleep(1500);
      p = await waitKind(['category_search', 'step1', 'form'], 60_000, '等待页面加载…');
    }
    if (!p) throw new Error('无法识别当前页面：既不是类目选择页也不是发布表单，请确认已登录拼多多商家后台');
    if (p.kind === 'login' || p.kind === 'captcha') p = await waitKind(['category_search', 'step1', 'form'], userWait);
    if (!p) throw new Error('等了很久登录或验证还没完成');
    deps.log(`页面类型：${({ category_search: '类目搜索页', step1: '上传图片和标题的第一步', form: '发布表单' } as Record<string, string>)[p.kind] ?? p.kind}`);

    if (p.kind === 'form') return;

    if (p.kind === 'category_search') {
      deps.log(`搜索类目：${plan.keyword}`);
      const { candidates } = await call<{ candidates: string[] }>('searchCategory', { keyword: plan.keyword }, 40_000);
      const d = decideCategory(plan.categoryPath, candidates, s.uncertainCategory);
      if (d.kind === 'ask') return askUser(d.reason, d.ranked);
      deps.log(`选择类目：${d.text}（${{ exact: '路径完全一致', only: '唯一候选', best: '最相近' }[d.why]}）`);
      await call('pickCategory', { text: d.text });
      await call('clickNext');
      if (!(await waitKind(['form'], 60_000))) await explainStuck(call);
      return;
    }

    // step1：新版第一步，先传图和标题，再点「下一步」让拼多多推荐类目
    await uploadImages();
    await call('fillTitle', { title: plan.title });
    deps.log('点「下一步」，等拼多多推荐类目…');
    await call('clickNext');
    const end = now() + 25_000;
    let cards: string[] = [];
    while (now() < end) {
      const q = await probe();
      if (q?.kind === 'form') { deps.log('拼多多直接进入了发布表单'); return; }
      try { cards = (await call<{ cards: { text: string }[] }>('listRecommended', {}, 8000)).cards.map((c) => c.text); } catch { /* 页面跳转中 */ }
      if (cards.length) break;
      await sleep(1000);
    }
    if (!cards.length) return askUser('拼多多没有推荐类目', []);
    const d = decideCategory(plan.categoryPath, cards, s.uncertainCategory);
    if (d.kind === 'ask') return askUser(d.reason, d.ranked);
    deps.log(`选择推荐类目：${d.text}`);
    await call('clickRecommended', { index: cards.indexOf(d.text) });
    await call('clickNext');
    if (!(await waitKind(['form'], 60_000))) await explainStuck(call);
  };

  const explainStuck = async (c: typeof call) => {
    const t = await c<{ tail: string }>('pageTail', { n: 1200 }).catch(() => ({ tail: '' }));
    const hits = ACCESS_HINTS.filter((h) => t.tail.includes(h));
    if (hits.length) throw new Error(`拼多多类目准入受限（页面出现：${hits.join('、')}）。请先在后台开通该类目的资质，这件商品跳过`);
    throw new Error(`等了 60 秒发布表单没有出现。页面尾部：${t.tail.slice(-120).replace(/\s+/g, ' ')}`);
  };

  try {
    if (deps.mode === 'submit' && !s.allowSubmit) throw new Error('设置里没有打开「允许提交上架」，只能保存草稿');
    if (plan.blockers.length) throw new Error(`上架前检查没通过：${plan.blockers.join('；')}`);

    await enterForm();
    stage = 'form';
    await waitKind(['form'], 30_000);
    await sleep(800);

    // 基本信息
    if (!imagesDone) await uploadImages();
    await call('fillTitle', { title: plan.title });
    deps.log(`标题：${plan.title}`);
    if (plan.brand) {
      const r = await call<{ filled: boolean; note?: string }>('fillBrand', { brand: plan.brand });
      deps.log(r.note ? `品牌：${r.note}` : `品牌：${plan.brand}`);
    }

    // 商品属性
    if (Object.keys(plan.attrs).length) {
      stage = 'attrs';
      const { labels } = await call<{ labels: string[] }>('listAttrs', {}, 15_000);
      let okN = 0;
      for (const [k, v] of Object.entries(plan.attrs)) {
        if (!v) continue;
        const label = matchAttrLabel(k, labels);
        if (!label) { deps.log(`属性「${k}」：页面上没有对应项，已跳过`); continue; }
        const r = await call<{ ok: boolean; note?: string }>('fillAttr', { label, value: v }, 15_000);
        if (r.ok) okN++; else deps.log(`属性：${r.note}`);
      }
      deps.log(`属性：填了 ${okN} 项`);
    }

    // 规格和价格库存
    stage = 'sku';
    const { specs, rows } = plan.sku;
    if (specs.length) {
      const { used } = await call<{ used: number }>('specSlots');
      const todo = specs.slice(0, 2 - used);
      if (used > 0) deps.log(`页面已预设 ${used} 个规格类型，新增 ${todo.length} 个`);
      for (const sp of todo) {
        deps.log(`添加规格类型「${sp.name}」：${sp.values.join('、')}`);
        const r = await call<{ added: number; total: number }>('addSpecType', { name: sp.name, values: sp.values }, 120_000);
        if (r.added < r.total) deps.log(`规格值只加上了 ${r.added}/${r.total} 个，请在窗口里核对`);
      }
    }
    // 规格表是异步生成的，等行数稳定
    let tableRows: { idx: number; text: string }[] = [];
    let last = -1;
    const end = now() + 15_000;
    while (now() < end) {
      tableRows = (await call<{ rows: { idx: number; text: string }[] }>('readSkuRows')).rows;
      if (tableRows.length > 0 && tableRows.length === last) break;
      last = tableRows.length;
      await sleep(1500);
    }
    if (!tableRows.length) throw new Error('没找到价格库存表，页面可能改版了');
    const where = specs.length ? locateRows(tableRows, specs, rows) : rows.map((_, i) => i);
    let filled = 0;
    for (let i = 0; i < rows.length; i++) {
      if (where[i] < 0) { deps.log(`规格「${rows[i].combo.join(' + ')}」没有对应到表格里的行，已跳过`); continue; }
      const r = rows[i];
      const ok = await call<{ ok: boolean; note?: string }>('fillSkuRow', { idx: where[i], stock: r.stock, group: r.group, single: r.single });
      if (ok.ok) filled++; else deps.log(ok.note ?? '填价格失败');
    }
    deps.log(`价格库存：填了 ${filled}/${rows.length} 行`);

    // 发货与承诺
    stage = 'options';
    if (plan.shipTime) await call('chooseText', { text: plan.shipTime });
    for (const t of plan.promises) {
      const r = await call<{ ok: boolean; note?: string }>('tickCheckbox', { text: t });
      if (!r.ok) deps.log(r.note ?? `没找到「${t}」`);
    }
    if (plan.invoiceMode) await call('tickCheckbox', { text: plan.invoiceMode });
    await sleep(1200);

    if (deps.mode === 'draft') {
      // 保存草稿
      stage = 'draft';
      const btn = await call<{ ok: boolean; note?: string }>('clickButtonByText', { texts: ['保存草稿', '存草稿'] });
      if (!btn.ok) throw new Error(btn.note ?? '没找到「保存草稿」按钮');
      const saved = await call<{ found: string }>('waitText', { texts: ['保存成功', '已保存', '草稿保存成功'], ms: 6000 }, 15_000);
      const err = await call<{ error: string }>('pageErrors');
      if (err.error) throw new Error(`保存草稿时页面提示：${err.error}`);
      const draftNote = saved.found ? '草稿已保存' : '已点「保存草稿」，没有读到成功提示，请到后台草稿箱核对';
      deps.log(draftNote);
      return result('draft', true, draftNote);
    }

    // 提交上架：需要设置里打开，并且这一次再确认
    stage = 'submit';
    if (!(await deps.confirmSubmit(plan))) return result('submit', false, '你取消了提交，表单已填好，停在页面上，可自己在窗口里保存草稿');
    const b2 = await call<{ ok: boolean; note?: string }>('clickButtonByText', { texts: ['提交并上架'] });
    if (!b2.ok) throw new Error(b2.note ?? '没找到「提交并上架」按钮');
    const end2 = now() + 30_000;
    while (now() < end2) {
      await sleep(2000);
      const q = await probe();
      if (q?.url.includes('/success')) { deps.log('已提交上架'); return result('submit', true, '已提交上架'); }
      const e = await call<{ error: string }>('pageErrors').catch(() => ({ error: '' }));
      if (e.error) throw new Error(`提交失败：${e.error}`);
    }
    throw new Error('提交后 30 秒没有看到成功页，请到后台核对');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, mode: deps.mode, stage, done: false, error: msg };
  }
}
