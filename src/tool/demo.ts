// 虚构的示例商品：用在 samples/、浏览器预览截图和测试里。全部是编出来的，标题里带「示例」，不对应任何真实商品、店铺或品牌。
import type { ExtensionPayload } from './types';

/** imgs(seed) 返回一张图片的地址（data: 地址）；不同 seed 要得到不同的图 */
export function demoPayloads(imgs: (seed: number) => string): ExtensionPayload[] {
  const t0 = '2026-10-27T09:30:00.000Z';
  return [
    {
      productName: '示例·304不锈钢保温杯大容量便携 厂家直销 批发 一件代发',
      description: '材质: 304不锈钢\n容量: 500ml\n保温时长: 12小时\n适用人群: 通勤 办公室\n品牌: 示例品牌',
      images: [imgs(1), imgs(2), imgs(3)],
      detailImages: [imgs(4), imgs(5)],
      skuList: [
        { name: '雾面黑 > 500ml', purchasePrice: 18.5, stock: 300 },
        { name: '雾面黑 > 800ml', purchasePrice: 22, stock: 200 },
        { name: '奶油白 > 500ml', purchasePrice: 18.5, stock: 260 },
        { name: '奶油白 > 800ml', purchasePrice: 22, stock: 120 },
      ],
      sourceUrl: 'https://detail.1688.com/offer/100000000001.html',
      timestamp: t0,
      weight_g: 380,
      platform: '1688',
    },
    {
      productName: '示例·纯棉短袖T恤男夏季宽松圆领 现货 新款',
      description: '材质: 纯棉\n领型: 圆领\n袖长: 短袖\n适用季节: 夏季\n风格: 简约',
      images: [imgs(6), imgs(7), imgs(8)],
      detailImages: [imgs(9)],
      skuList: [
        { name: '白色 > M', purchasePrice: 15.8, stock: 500 },
        { name: '白色 > L', purchasePrice: 15.8, stock: 500 },
        { name: '黑色 > M', purchasePrice: 16.8, stock: 400 },
        { name: '黑色 > L', purchasePrice: 16.8, stock: 400 },
        { name: '黑色 > XL', purchasePrice: 17.8, stock: 300 },
      ],
      sourceUrl: 'https://detail.1688.com/offer/100000000002.html',
      timestamp: t0,
      weight_g: 220,
      platform: '1688',
    },
    {
      productName: '示例·硅胶锅铲不粘锅专用耐高温厨房家用',
      description: '材质: 食品级硅胶\n颜色: 灰色\n适用场景: 家用厨房',
      images: [imgs(10), imgs(11)],
      detailImages: [imgs(12)],
      skuList: [{ name: '默认', purchasePrice: 4.2, stock: 1000 }],
      sourceUrl: 'https://item.taobao.com/item.htm?id=200000000003',
      timestamp: t0,
      weight_g: 90,
      platform: 'taobao',
    },
  ];
}
