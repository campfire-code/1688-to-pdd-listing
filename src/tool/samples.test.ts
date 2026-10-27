// 示例文件：samples/ 里的采集数据由 demo.ts 生成（MAKE_SAMPLES=1 重新生成）。这里检查它没有过期、能完整走通入库。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoPayloads } from './demo';
import { buildTables, PRODUCT_HEADERS } from './export';
import { Library, parsePayloadFile } from './library';
import { memoryIO } from './memio';
import { fakeFetcher, pngDataUrl } from './testutil';
import { DEFAULT_SETTINGS } from './types';

const file = resolve(__dirname, '..', '..', 'samples', '示例-插件采集数据.json');

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例文件', () => {
  mkdirSync(resolve(__dirname, '..', '..', 'samples'), { recursive: true });
  writeFileSync(file, JSON.stringify(demoPayloads(pngDataUrl), null, 2) + '\n');
});

describe('示例文件', () => {
  it('示例文件存在，内容和 demo.ts 生成的一致', () => {
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))).toEqual(demoPayloads(pngDataUrl));
  });
  it('标题都带「示例」，没有真实品牌或店铺', () => {
    for (const p of parsePayloadFile(readFileSync(file, 'utf8'))) {
      expect(p.productName).toContain('示例');
      expect(JSON.stringify(p)).not.toMatch(/shopName/);
    }
  });
  it('验收用例：导入示例 → 3 件商品，图片全部下载，数据包里的价格和 README 写的一致', async () => {
    const io = memoryIO();
    const lib = new Library(io, '/lib');
    for (const payload of parsePayloadFile(readFileSync(file, 'utf8'))) {
      const { product } = await lib.upsertFromPayload(payload, DEFAULT_SETTINGS);
      await lib.downloadImages(product.id, fakeFetcher({}).fetcher);
    }
    const list = (await lib.list()).sort((a, b) => a.id.localeCompare(b.id));
    expect(list.map((p) => [p.id, p.localMain.length, p.localDetail.length, p.skus.length])).toEqual([
      ['100000000001', 3, 2, 4], ['100000000002', 3, 1, 5], ['tb_200000000003', 2, 1, 1],
    ]);
    const rows = buildTables(list, DEFAULT_SETTINGS).products.rows;
    const price = PRODUCT_HEADERS.indexOf('价格(拼单价)');
    expect(rows.map((r) => [r[0], r[price], r[price + 1]])).toEqual([
      ['示例·304不锈钢保温杯大容量便携', 27.75, 34.23],
      ['示例·纯棉短袖T恤男夏季宽松圆领', 23.7, 29.23],
      ['示例·硅胶锅铲不粘锅专用耐高温厨房家用', 6.3, 7.77],
    ]);
  });
});
