// 浏览器插件的页面提取：在 jsdom 里加载插件的内容脚本，对 5 份固定的 1688 页面样本跑一遍，检查提取结果。
// 另外检查插件包本身：权限范围、不含采集页面以外的网址、不含反检测或自动过验证的代码。
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');
const ext = join(root, 'extension');
const script1688 = readFileSync(join(ext, 'content', '1688-product.js'), 'utf8');

function load(name: string) {
  const html = readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  const dom = new JSDOM(html, { url: 'https://detail.1688.com/offer/1234567890.html', runScripts: 'dangerously' });
  const timers: (() => void)[] = [];
  (dom.window as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void) => { timers.push(fn); return timers.length - 1; };
  (dom.window as unknown as { clearTimeout: unknown }).clearTimeout = (id: number) => { timers[id] = () => {}; };
  const listeners: ((req: unknown, sender: unknown, send: (r: unknown) => void) => void)[] = [];
  const sent: unknown[] = [];
  (dom.window as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
      sendMessage: (msg: { action?: string }, cb?: (r: unknown) => void) => { sent.push(msg); if (msg?.action === 'fetchDescApi' && cb) cb({ html: '' }); },
      lastError: null,
    },
  };
  dom.window.eval(script1688);
  return {
    sent,
    extract: () => {
      let result: { success: boolean; data: Record<string, any>; error?: string } | null = null;
      for (const l of listeners) { l({ action: 'extract' }, {}, (r) => { result = r as typeof result; }); if (result) break; }
      while (timers.length) timers.shift()?.();
      return result!;
    },
    close: () => dom.window.close(),
  };
}

describe('1688 页面提取（5 份样本）', () => {
  const pages: Record<string, ReturnType<typeof load>> = {};
  beforeAll(() => {
    for (const n of ['standard', 'multi-sku', 'price-scale', 'dom-fallback', 'sparse']) pages[n] = load(`1688-${n}.html`);
    return () => Object.values(pages).forEach((p) => p.close());
  });

  it('完整页面：标题、主图、带价格的多个规格、来源链接和时间', () => {
    const r = pages.standard.extract();
    expect(r.success).toBe(true);
    expect(r.data.productName).toContain('连衣裙');
    expect(r.data.images.length).toBeGreaterThanOrEqual(3);
    expect(r.data.skuList.length).toBeGreaterThanOrEqual(1);
    expect(r.data.sourceUrl).toContain('detail.1688.com/offer/1234567890');
    expect(new Date(r.data.timestamp).toString()).not.toBe('Invalid Date');
  });
  it('多规格页面：颜色 × 版本 = 12 个规格，每个带价格', () => {
    const r = pages['multi-sku'].extract();
    expect(r.data.skuList).toHaveLength(12);
    expect(r.data.skuList[0].purchasePrice).toBeGreaterThan(0);
    expect(r.data.skuList.map((s: { name: string }) => s.name)).toContain('黑色 > 标准版');
  });
  it('阶梯价页面能提取到价格', () => {
    const r = pages['price-scale'].extract();
    expect(r.success).toBe(true);
    expect(r.data.skuList.some((s: { purchasePrice: number }) => s.purchasePrice > 0)).toBe(true);
  });
  it('没有页面数据时退回读页面元素；数据很少的页面也不报错', () => {
    expect(pages['dom-fallback'].extract().success).toBe(true);
    expect(pages.sparse.extract().success).toBe(true);
  });
  it('每次提取都带 detailHtml（字符串）和 detailImages（数组）', () => {
    for (const n of Object.keys(pages)) {
      const r = pages[n].extract();
      expect(typeof r.data.detailHtml).toBe('string');
      expect(Array.isArray(r.data.detailImages)).toBe(true);
    }
  });
  it('提取结果交给应用的字段，应用侧都能读（productName / images / skuList / sourceUrl）', async () => {
    const { fromExtension } = await import('./import');
    const r = pages['multi-sku'].extract();
    const p = fromExtension(r.data as never, { titleMax: 30 });
    expect(p.id).toBe('1234567890');
    expect(p.skus).toHaveLength(12);
    expect(p.cost).toBeGreaterThan(0);
    expect(p.mainImages.length).toBeGreaterThan(0);
  });
});

describe('插件包本身', () => {
  const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); });
  walk(ext);
  const text = (f: string) => readFileSync(f, 'utf8');

  it('只在 1688 / 淘宝 / 天猫页面运行，只往本机 127.0.0.1:48765 发数据', () => {
    const hosts: string[] = manifest.host_permissions;
    expect(hosts.filter((h) => !/^(\*:\/\/)?\*?\.?(1688|alibaba|taobao|tmall|taobaocdn|tbcdn|alicdn)/.test(h.replace('*://', '')) && !h.startsWith('http://127.0.0.1:48765/'))).toEqual([]);
    for (const cs of manifest.content_scripts) expect(cs.matches.join()).toMatch(/1688\.com|taobao\.com|tmall/);
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage']);
  });
  it('内容脚本都存在，没有多余文件（不含拼多多 / 闲鱼采集、诊断脚本）', () => {
    for (const cs of manifest.content_scripts) for (const f of cs.js) expect(files).toContain(join(ext, f));
    expect(files.map((f) => f.slice(ext.length + 1)).sort()).toEqual([
      'background.js', 'content/1688-main.js', 'content/1688-product.js', 'content/taobao-main.js', 'content/taobao-product.js',
      'icons/icon128.png', 'icons/icon16.png', 'icons/icon48.png', 'manifest.json', 'popup/popup.html', 'popup/popup.js',
    ]);
  });
  it('请求只发往：本机应用、页面自己所在平台（取详情描述）', () => {
    for (const f of files.filter((x) => x.endsWith('.js') || x.endsWith('.html'))) {
      const urls = text(f).match(/https?:\/\/[^\s'"`)\\]+/g) ?? [];
      for (const u of urls) expect(u, `${f} 里的 ${u}`).toMatch(/^https?:\/\/(127\.0\.0\.1|(www|detail|item|[\w-]+)\.(1688|alibaba|taobao|tmall)\.(com|hk)|www\.w3\.org)/);
    }
  });
  it('不含反检测、伪装、自动过验证的代码（遇到验证只提示用户自己处理）', () => {
    const bad = /webdriver|navigator\.plugins|userAgentData|bezier|mousemove|dispatchEvent\(new (Mouse|Pointer)Event|slider|nc_|captcha\.(solve|bypass)|stealth|fingerprint/i;
    for (const f of files.filter((x) => x.endsWith('.js'))) {
      const hits = (text(f).match(new RegExp(bad.source, 'gi')) ?? []).filter((h) => !/dispatchEvent\(new CustomEvent/.test(h));
      expect(hits, f).toEqual([]);
    }
  });
});
