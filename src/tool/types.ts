// 数据结构：浏览器插件发来的商品、本地产品库里的商品、工具设置。
export type Platform = '1688' | 'taobao' | 'tmall' | 'other';
export type ProductStatus = 'collected' | 'ready' | 'drafted' | 'submitted' | 'failed';

/** 插件采集到的一条规格（1688 / 淘宝页面里读出来的原样） */
export interface ExtSku {
  name: string;
  specDesc?: string;
  purchasePrice?: number;
  stock?: number;
  specId?: string;
  _skuImage?: string;
}

/** 浏览器插件发给应用的商品 JSON */
export interface ExtensionPayload {
  productName: string;
  description?: string;
  images?: string[];
  detailImages?: string[];
  skuList?: ExtSku[];
  sourceUrl?: string;
  timestamp?: string;
  weight_g?: number;
  packageSize?: string;
  platform?: string;
  shopName?: string;
  detailHtml?: string;
}

export interface Product {
  /** 来源编号：1688 是货源号，淘宝/天猫带 tb_ 前缀；同一个编号重复采集会更新而不是新增 */
  id: string;
  platform: Platform;
  sourceUrl: string;
  /** 采集到的原始标题 */
  title: string;
  /** 上架用的标题（清洗或大模型优化后），可手动改 */
  cleanTitle: string;
  shop: string;
  /** 进价（元）：各规格里最低的那个 */
  cost: number | null;
  description: string;
  attrs: Record<string, string>;
  brand: string;
  weightKg: number | null;
  mainImages: string[];
  detailImages: string[];
  /** 已下载到本地的图片，相对产品文件夹，如 main/main_01.jpg */
  localMain: string[];
  localDetail: string[];
  skus: ExtSku[];
  /** 想上到拼多多的类目，用 ">" 分层，如「男装 > T恤 > T恤」；留空则用标题里的关键词搜索 */
  categoryPath: string;
  note: string;
  status: ProductStatus;
  lastError: string;
  collectedAt: number;
  updatedAt: number;
}

export interface ToolSettings {
  /** 标题最多字数（沿用参考实现的 30，以平台实际限制为准） */
  titleMax: number;
  /** 拼单价 = 进价 × 这个系数 */
  groupMultiplier: number;
  /** 单买价 = 进价 × 这个系数 */
  singleMultiplier: number;
  defaultStock: number;
  shipTime: string;
  invoiceMode: string;
  /** 要勾选的承诺项（卖家对买家的承诺，默认一个都不勾，由卖家自己决定） */
  promises: string[];
  /** 允许「提交上架」按钮出现；关闭时只能保存草稿 */
  allowSubmit: boolean;
  /** 类目搜不到唯一结果时：pause 暂停等你在窗口里自己选；best 选最相近的 */
  uncertainCategory: 'pause' | 'best';
  /** 第一、第二个规格类型在拼多多里的名称 */
  specTypeNames: [string, string];
  logisticsTemplate: string;
  cleanProfile: CleanProfile;
  autoDownload: boolean;
}

export type CleanProfile = 'marketplace' | 'scene' | 'minimal';

export const DEFAULT_SETTINGS: ToolSettings = {
  titleMax: 30,
  groupMultiplier: 1.5,
  singleMultiplier: 1.85,
  defaultStock: 100,
  shipTime: '48小时发货及揽收',
  invoiceMode: '每单必开',
  promises: [],
  allowSubmit: false,
  uncertainCategory: 'pause',
  specTypeNames: ['款式', '尺寸'],
  logisticsTemplate: '',
  cleanProfile: 'marketplace',
  autoDownload: true,
};
