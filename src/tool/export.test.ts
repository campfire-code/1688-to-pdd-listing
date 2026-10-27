import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildTables, PRODUCT_HEADERS, referenceField, SKU_HEADERS, specCell, toCsv, toXlsx, writePack } from './export';
import { demoPayloads } from './demo';
import { fromExtension } from './import';
import { Library } from './library';
import { memoryIO } from './memio';
import { fakeFetcher, pngDataUrl } from './testutil';
import { DEFAULT_SETTINGS } from './types';

const S = DEFAULT_SETTINGS;
async function setup() {
  const io = memoryIO();
  const lib = new Library(io, '/library');
  await lib.init();
  for (const p of demoPayloads(pngDataUrl)) {
    const { product } = await lib.upsertFromPayload(p, S);
    await lib.downloadImages(product.id, fakeFetcher({}).fetcher);
  }
  const list = (await lib.list()).sort((a, b) => a.id.localeCompare(b.id));
  return { io, lib, list };
}

describe('上架数据包', () => {
  it('列名按参考实现的识别规则都能被认到各自的字段，且没有两列认成同一个字段', () => {
    const want: Record<string, string | null> = {
      商品标题: 'title', 类目: 'category', '价格(拼单价)': 'price', 单买价: null, 库存: 'stock', 主图: 'main_images', 详情图: 'detail_images',
      规格: 'sku_specs', 组合明细: null, 描述: 'description', 商品属性: 'attrs', 品牌: 'brand', '重量(kg)': 'weight_kg', 物流模板: 'logistics_template',
      进价: null, 来源链接: null, 来源编号: null, 待处理: null,
    };
    expect(Object.keys(want)).toEqual([...PRODUCT_HEADERS]);
    for (const h of PRODUCT_HEADERS) expect(referenceField(h), h).toBe(want[h]);
    const mapped = PRODUCT_HEADERS.map(referenceField).filter(Boolean);
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it('商品表：价格、库存、规格、图片路径、属性、待处理', async () => {
    const { list } = await setup();
    const t = buildTables(list, S);
    expect(t.products.rows).toHaveLength(3);
    const [cup, tee, spatula] = t.products.rows;
    const col = (name: string) => PRODUCT_HEADERS.indexOf(name as never);
    expect(cup[col('商品标题')]).toBe('示例·304不锈钢保温杯大容量便携');
    expect(cup[col('价格(拼单价)')]).toBe(27.75);
    expect(cup[col('单买价')]).toBe(34.23);
    expect(cup[col('库存')]).toBe(400);
    expect(cup[col('规格')]).toBe('款式:雾面黑/奶油白;尺寸:500ml/800ml');
    expect(cup[col('主图')]).toBe('100000000001/main_01.png;100000000001/main_02.png;100000000001/main_03.png');
    expect(cup[col('详情图')]).toBe('100000000001/detail_01.png;100000000001/detail_02.png');
    expect(cup[col('商品属性')]).toContain('材质:304不锈钢');
    expect(cup[col('重量(kg)')]).toBe(0.38);
    expect(cup[col('品牌')]).toBe('示例品牌');
    expect(cup[col('待处理')]).toBe('');
    expect(tee[col('库存')]).toBe(500); // 5 个 1688 规格 × 100，补出来的 1 个组合库存为 0
    expect(tee[col('待处理')]).toContain('1688 里不存在');
    expect(spatula[col('规格')]).toBe('');
    expect(spatula[col('来源编号')]).toBe('tb_200000000003');
  });

  it('规格明细：每个组合一行，补出来的组合有说明', async () => {
    const { list } = await setup();
    const t = buildTables(list, S).skus;
    expect([...t.headers]).toEqual([...SKU_HEADERS]);
    expect(t.rows).toHaveLength(4 + 6 + 1);
    const filler = t.rows.find((r) => String(r[7]).includes('1688 里没有'));
    expect(filler?.[2]).toBe('白色 + XL');
    expect(filler?.[5]).toBe(0);
  });

  it('规格值里的分隔符换成全角，不会和「;」「:」「/」混淆', () => {
    const p = fromExtension({ productName: '示例', skuList: [{ name: '红;色 > 1/2:码', purchasePrice: 1 }] }, { titleMax: 30 });
    expect(specCell(p, S)).toBe('款式:红；色;尺寸:1／2：码');
  });

  it('CSV：带 BOM，含逗号、引号、换行的单元格加引号', () => {
    const csv = toCsv({ headers: ['a', 'b'], rows: [['x,y', 'say "hi"\n换行'], [1, '']] });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿a,b\r\n"x,y","say ""hi""\n换行"\r\n1,\r\n');
  });

  it('Excel：两个工作表，读回来和表一致', async () => {
    const { list } = await setup();
    const t = buildTables(list, S);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(t.products, t.skus)).buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['商品', '规格明细']);
    const ws = wb.getWorksheet('商品')!;
    expect(ws.rowCount).toBe(4);
    expect(ws.getRow(1).getCell(1).value).toBe('商品标题');
    expect(ws.getRow(2).getCell(3).value).toBe(27.75);
    expect(wb.getWorksheet('规格明细')!.rowCount).toBe(12);
  });

  it('写出数据包文件夹：商品表、CSV、图片按「编号/文件名」存放，和表里的路径一致', async () => {
    const { io, lib, list } = await setup();
    const r = await writePack(list, S, lib, io, '/out', { formats: ['xlsx', 'csv'], images: true, dirName: '包' });
    expect(r.dir).toBe('/out/包');
    expect(r.files).toEqual(['商品表.xlsx', '商品表.csv', '规格明细.csv']);
    expect(r.imageCount).toBe(list.reduce((n, p) => n + p.localMain.length + p.localDetail.length, 0));
    for (const f of buildTables(list, S).products.rows[0][5].toString().split(';')) expect(await io.exists(`/out/包/images/${f}`)).toBe(true);
    expect(await io.readText('/out/包/商品表.csv')).toContain('示例·304不锈钢保温杯大容量便携');
    const noImg = await writePack(list, S, lib, io, '/out2', { formats: ['csv'], images: false, dirName: 'x' });
    expect(noImg.imageCount).toBe(0);
    expect(await io.exists('/out2/x/images')).toBe(false);
  });

  it('没有进价和主图的商品也能导出，「待处理」写明问题', async () => {
    const io = memoryIO();
    const lib = new Library(io, '/l');
    const { product } = await lib.upsertFromPayload({ productName: '示例 空商品', sourceUrl: 'https://detail.1688.com/offer/1.html' }, S);
    const t = buildTables([product], S);
    expect(String(t.products.rows[0][PRODUCT_HEADERS.indexOf('待处理')])).toContain('缺少进价');
    expect(String(t.products.rows[0][PRODUCT_HEADERS.indexOf('待处理')])).toContain('没有已下载的主图');
  });
});
