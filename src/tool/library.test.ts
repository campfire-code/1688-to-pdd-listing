// 产品库、图片下载、收件箱入库、导入文件解析（用内存文件夹和假网络，不访问真实网络）。
import { describe, expect, it } from 'vitest';
import { downloadImages, MIN_IMAGE_BYTES, refererFor, sniffExt, decodeDataUrl } from './images';
import { Library, parsePayloadFile } from './library';
import { memoryIO } from './memio';
import { demoPayloads } from './demo';
import { fakeFetcher, makePng, pngDataUrl } from './testutil';
import { DEFAULT_SETTINGS } from './types';

const S = DEFAULT_SETTINGS;
const png = (n: number) => makePng(n);

describe('图片下载', () => {
  it('测试用 PNG 够大（大于最小尺寸）且文件头正确', () => {
    expect(png(1).length).toBeGreaterThan(MIN_IMAGE_BYTES);
    expect(sniffExt(png(1), 'x')).toBe('png');
  });
  it('按内容或后缀判断格式', () => {
    expect(sniffExt(new Uint8Array([0xff, 0xd8, 0xff]), 'a')).toBe('jpg');
    expect(sniffExt(new Uint8Array([1, 2, 3]), 'https://a.com/x.WEBP?v=1')).toBe('webp');
    expect(sniffExt(new Uint8Array([1, 2, 3]), 'https://a.com/x')).toBe('jpg');
  });
  it('data: 地址解码；其它返回 null', () => {
    expect(decodeDataUrl(pngDataUrl(2))!.length).toBe(png(2).length);
    expect(decodeDataUrl('https://a.com/1.jpg')).toBeNull();
  });
  it('1688 和淘宝带各自的 Referer', () => {
    expect(refererFor('', '1688')).toContain('1688.com');
    expect(refererFor('', 'tmall')).toContain('taobao.com');
  });
  it('下载：编号命名、跳过过小的占位图、失败的单独列出、请求带 Referer', async () => {
    const io = memoryIO();
    const { fetcher, calls } = fakeFetcher({ 'https://a.com/1.jpg': png(1), 'https://a.com/2.jpg': new Uint8Array(100), 'https://a.com/4.png': png(4), 'https://a.com/5.jpg': 403 });
    const urls = ['https://a.com/1.jpg', 'https://a.com/2.jpg', 'https://a.com/3.jpg', 'https://a.com/4.png', 'https://a.com/5.jpg', pngDataUrl(6)];
    const r = await downloadImages(urls, '/lib/p1', 'main', 'main', { io, fetcher, platform: '1688' });
    expect(r.saved).toEqual(['main/main_01.png', 'main/main_04.png', 'main/main_06.png']);
    expect(r.failed).toEqual(['https://a.com/2.jpg', 'https://a.com/3.jpg', 'https://a.com/5.jpg']);
    expect(await io.exists('/lib/p1/main/main_01.png')).toBe(true);
    expect(calls[0].headers?.Referer).toBe('https://detail.1688.com/');
  });
  it('已取消时抛错', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(downloadImages(['https://a.com/1.jpg'], '/p', 'main', 'main', { io: memoryIO(), fetcher: fakeFetcher({}).fetcher, platform: '1688', signal: ac.signal })).rejects.toThrow('已取消');
  });
});

describe('产品库', () => {
  const payloads = () => demoPayloads(pngDataUrl);
  const setup = async () => { const io = memoryIO(); const lib = new Library(io, '/library'); await lib.init(); return { io, lib }; };

  it('入库、列表、读取、删除', async () => {
    const { lib } = await setup();
    const [a, b] = payloads();
    const r1 = await lib.upsertFromPayload(a, S);
    expect(r1.created).toBe(true);
    await lib.upsertFromPayload(b, S);
    expect((await lib.list()).map((p) => p.id).sort()).toEqual(['100000000001', '100000000002']);
    expect((await lib.get('100000000001'))?.platform).toBe('1688');
    await lib.remove('100000000001');
    expect(await lib.get('100000000001')).toBeNull();
    expect(await lib.list()).toHaveLength(1);
  });
  it('重复采集不新增，保留用户改过的内容', async () => {
    const { lib } = await setup();
    const [a] = payloads();
    const { product } = await lib.upsertFromPayload(a, S);
    await lib.save({ ...product, categoryPath: '家居 > 保温杯', cleanTitle: '我改的' });
    const r = await lib.upsertFromPayload(a, S);
    expect(r.created).toBe(false);
    expect(r.product).toMatchObject({ categoryPath: '家居 > 保温杯', cleanTitle: '我改的' });
    expect(await lib.list()).toHaveLength(1);
  });
  it('下载图片：主图和详情图落盘，状态变为可上架；已下载的不重复下载', async () => {
    const { lib, io } = await setup();
    const [a] = payloads();
    const { product } = await lib.upsertFromPayload(a, S);
    expect(product.status).toBe('collected');
    const { fetcher, calls } = fakeFetcher({});
    const done = await lib.downloadImages(product.id, fetcher);
    expect(done.localMain).toHaveLength(3);
    expect(done.localDetail).toHaveLength(2);
    expect(done.status).toBe('ready');
    expect(await io.exists(lib.imagePath(done, done.localMain[0]))).toBe(true);
    await lib.downloadImages(product.id, fetcher);
    expect(calls).toHaveLength(0); // data: 地址不走网络，且第二次直接跳过
  });
  it('主图一张都没下成功：保持待下载状态并写明原因', async () => {
    const { lib } = await setup();
    const { product } = await lib.upsertFromPayload({ productName: '示例 杯子', images: ['https://a.com/x.jpg'], sourceUrl: 'https://detail.1688.com/offer/9.html' }, S);
    const done = await lib.downloadImages(product.id, fakeFetcher({}).fetcher);
    expect(done).toMatchObject({ status: 'collected', lastError: '主图一张都没下载成功' });
  });
  it('收件箱：入库并下载、删除收件文件；坏文件挪到 _failed', async () => {
    const { lib, io } = await setup();
    const [a, b] = payloads();
    await io.writeText('/inbox/1.json', JSON.stringify(a));
    await io.writeText('/inbox/2.json', JSON.stringify(b));
    await io.writeText('/inbox/3.json', '{坏的');
    await io.writeText('/inbox/4.json', JSON.stringify({ foo: 1 }));
    await io.writeText('/inbox/5.json.part', '写了一半');
    const msgs: string[] = [];
    const r = await lib.importInbox('/inbox', S, fakeFetcher({}).fetcher, (m) => msgs.push(m));
    expect(r.imported.map((p) => p.id)).toEqual(['100000000001', '100000000002']);
    expect(r.imported.every((p) => p.localMain.length > 0)).toBe(true);
    expect(r.failed).toHaveLength(2);
    expect(await io.exists('/inbox/1.json')).toBe(false);
    expect(await io.exists('/inbox/_failed/3.json')).toBe(true);
    expect(await io.exists('/inbox/5.json.part')).toBe(true);
    expect(msgs).toHaveLength(2);
    const again = await lib.importInbox('/inbox', S, fakeFetcher({}).fetcher);
    expect(again.imported).toHaveLength(0);
  });
  it('关闭自动下载时只入库', async () => {
    const { lib, io } = await setup();
    await io.writeText('/inbox/1.json', JSON.stringify(payloads()[0]));
    const r = await lib.importInbox('/inbox', { ...S, autoDownload: false }, fakeFetcher({}).fetcher);
    expect(r.imported[0].localMain).toEqual([]);
  });
  it('导入文件：单个、数组、{data} 都能读；没有商品报错', () => {
    const [a, b] = payloads();
    expect(parsePayloadFile(JSON.stringify(a))).toHaveLength(1);
    expect(parsePayloadFile(JSON.stringify([a, b]))).toHaveLength(2);
    expect(parsePayloadFile(JSON.stringify({ data: a }))).toHaveLength(1);
    expect(() => parsePayloadFile(JSON.stringify({ x: 1 }))).toThrow('没有找到商品数据');
    expect(() => parsePayloadFile('不是 JSON')).toThrow();
  });
  it('坏掉的 product.json 不影响其它商品', async () => {
    const { lib, io } = await setup();
    await lib.upsertFromPayload(payloads()[0], S);
    await io.writeText('/library/坏的/product.json', '{');
    expect(await lib.list()).toHaveLength(1);
  });
});
