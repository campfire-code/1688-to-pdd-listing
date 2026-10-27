// 工具声明：1688→拼多多上架。浏览器插件采集 → 本地产品库 → 拼多多商家后台保存草稿 / 导出上架数据包。
import { PackageCheck } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'e01',
  name: '1688 拼多多铺货助手',
  tagline: '用浏览器插件把 1688、淘宝、天猫商品采集到本机，整理标题、规格和价格，在拼多多商家后台自动保存草稿，或导出上架数据包人工导入。',
  icon: PackageCheck,
  category: '电商运营',
  type: 'data',
  mode: 'custom',
  mainLabel: '上架工作台',
  needsLLM: true,
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
