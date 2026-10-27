import type { ComponentType, ReactNode } from 'react';

// 工具声明：每个工具只描述「收什么、调什么参数、怎么处理」，界面由 kit 按抽到的布局渲染。

export type ToolType = 'media' | 'data' | 'text';
export type LayoutId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
export type PaletteId = 'blue' | 'teal' | 'orange' | 'amber' | 'green' | 'violet' | 'rose';

export type Field =
  | { key: string; label: string; type: 'segment'; when?: (p: Params) => boolean; options: [string, string][]; default: string; help?: string }
  | { key: string; label: string; type: 'select'; when?: (p: Params) => boolean; options: [string, string][]; default: string; help?: string }
  | { key: string; label: string; type: 'number'; when?: (p: Params) => boolean; default: number; min?: number; max?: number; step?: number; unit?: string; help?: string }
  | { key: string; label: string; type: 'text'; when?: (p: Params) => boolean; default: string; placeholder?: string; help?: string }
  | { key: string; label: string; type: 'textarea'; when?: (p: Params) => boolean; default: string; placeholder?: string; rows?: number; help?: string }
  | { key: string; label: string; type: 'toggle'; when?: (p: Params) => boolean; default: boolean; help?: string }
  | { key: string; label: string; type: 'folder'; when?: (p: Params) => boolean; default: string; help?: string }
  /** 选择单个文件：值是文件路径 */
  | { key: string; label: string; type: 'file'; when?: (p: Params) => boolean; extensions: string[]; fileLabel: string; default: string; help?: string }
  /** 多选：值是用英文逗号连接的选项键，例如 "taobao,pdd" */
  | { key: string; label: string; type: 'multi'; when?: (p: Params) => boolean; options: [string, string][]; default: string; help?: string };

export type Params = Record<string, string | number | boolean>;

/** 一个待处理的输入：批量模式下是一个文件，生成模式下是一次生成请求 */
export interface InputItem {
  id: string;
  name: string;
  /** 本机文件路径（批量模式） */
  path?: string;
  size?: number;
}

export interface ItemResult {
  /** 一行说明，显示在结果旁边 */
  summary?: string;
  /** 输出文件路径，可在列表里「在文件夹中显示」 */
  outputPath?: string;
  /** 预览：本机图片路径或 data: 地址 */
  preview?: string;
  /** 文本结果（生成模式），显示在界面上 */
  text?: string;
  /** 点「复制」时复制的内容，不填就复制 text */
  copyText?: string;
  /** 条目显示名（生成模式默认「第 N 条」） */
  title?: string;
  /** 表格结果的一行，键对应 ToolDef.columns */
  row?: Record<string, string | number>;
  /** 留给 afterAll 用的数据，不显示 */
  data?: unknown;
}

export interface RunContext {
  params: Params;
  /** 输出文件夹（参数里 type=folder 的第一个字段，未设置时为下载目录下以工具名命名的文件夹） */
  outputDir: string;
  signal: AbortSignal;
  progress(ratio: number): void;
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  /** 建文件夹（含上级）；writeFile / writeText 也会自动建好上级文件夹 */
  mkdir(path: string): Promise<void>;
  join(...parts: string[]): Promise<string>;
  /** 调用用户配置的大模型（OpenAI 兼容接口），返回回复文本 */
  llm(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], opts?: { json?: boolean; temperature?: number }): Promise<string>;
  /** 调用内置 Python 程序（工具启用 sidecar 时可用），参数为命令行参数，返回标准输出 */
  sidecar(args: string[]): Promise<string>;
  /** 调用内置 ffmpeg（tool.json 写 "ffmpeg": true 时可用）；onTime 收到已处理秒数 */
  ffmpeg(args: string[], onTime?: (seconds: number) => void): Promise<void>;
  /** 读取音视频时长（秒），需要内置 ffmpeg */
  duration(path: string): Promise<number>;
}

interface ToolBase {
  id: string;
  name: string;
  /** 一句话说明，显示在空状态和关于页 */
  tagline: string;
  category: string;
  type: ToolType;
  params: Field[];
  needsLLM?: boolean;
  /** 工具图标（lucide-react 的图标组件），用在侧栏 logo 和导航里；不填用图片图标 */
  icon?: ComponentType<{ size?: number }>;
  /** 结果展示形态 */
  resultView: 'list' | 'table' | 'cards' | 'text';
  /** 自定义空状态（还没添加内容时），用来讲清这个工具具体做什么；不填用通用的拖放区 */
  Empty?: ComponentType<{ hover: boolean }>;
  /** 自定义单条结果的展示（处理成功后），例如前后对比、识别出的文字；不填用通用的缩略图和一行说明 */
  ResultBody?: ComponentType<{ item: InputItem; result: ItemResult }>;
  /** resultView=table 时的列：[键, 标题] */
  columns?: [string, string][];
  /** 并发数，默认 2 */
  concurrency?: number;
  /** 汇总导出（例如把所有行导出成一个 Excel），返回导出文件路径 */
  exportAll?: (results: { item: InputItem; result: ItemResult }[], ctx: RunContext) => Promise<string>;
  exportLabel?: string;
  /** 整批处理完（没有被暂停）后自动执行的收尾，比如把所有文件合并成一个；返回要告诉用户的话 */
  afterAll?: (results: { item: InputItem; result: ItemResult }[], ctx: RunContext) => Promise<string | void>;
}

export interface BatchTool extends ToolBase {
  mode: 'batch';
  accept: { label: string; extensions: string[] };
  /** 处理前检查单个文件，返回错误说明则不处理 */
  check?: (item: InputItem) => string | null;
  run(item: InputItem, ctx: RunContext): Promise<ItemResult>;
}

export interface GenerateTool extends ToolBase {
  mode: 'generate';
  /** 一次生成几条，由参数决定时返回数量 */
  count?: (params: Params) => number;
  /** 生成前的条目名，例如按日期显示「10月24日 第1条」，不填为「第 N 条」 */
  itemName?: (index: number, params: Params) => string;
  generate(index: number, ctx: RunContext): Promise<ItemResult>;
  generateLabel?: string;
}

/** 自定义型：工具自己渲染主体内容（例如话术库、看板），框架提供外框、导航、关于与设置 */
export interface CustomTool extends Omit<ToolBase, 'resultView'> {
  mode: 'custom';
  resultView?: never;
  /** 主页面在导航里的名字，默认「主页」 */
  mainLabel?: string;
  Main: (props: { ctx: Pick<RunContext, 'readFile' | 'readText' | 'writeFile' | 'writeText' | 'mkdir' | 'join' | 'llm' | 'sidecar' | 'ffmpeg' | 'duration'> }) => ReactNode;
}

export type ToolDef = BatchTool | GenerateTool | CustomTool;

export interface ToolMeta {
  id: string;
  slug: string;
  name: string;
  version: string;
  repo: string;
  license: string;
  /** accent：工具自己的主色（#RRGGBB），覆盖 palette 的主色 */
  ui: { layout: LayoutId; palette: PaletteId; accent?: string };
  upstream?: { repo: string; license: string } | null;
}
