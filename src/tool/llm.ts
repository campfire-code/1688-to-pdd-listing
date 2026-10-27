// 大模型：标题优化与商品问答。接口地址、密钥、模型名由用户在「设置」页自己填（兼容 OpenAI 接口格式），应用里不内置任何密钥。
import type { CleanProfile, Product } from './types';
import { clampChars, normalizeText } from './clean';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatFn = (messages: Msg[], opts?: { json?: boolean; temperature?: number }) => Promise<string>;

/** 三种标题风格（沿用参考实现的说明） */
export const PROFILE_TEXT: Record<CleanProfile, { label: string; desc: string; prompt: string }> = {
  marketplace: {
    label: '合规标题',
    desc: '默认。标题清楚自然，优先写品类、材质、规格、适用人群或场景。',
    prompt: '标题要合规、清楚、自然，优先表达商品品类、材质、规格、适用人群或使用场景。避免夸张承诺和绝对化词。',
  },
  scene: {
    label: '场景卖点',
    desc: '突出使用场景和适用人群，但不虚构商品没有的功能。',
    prompt: '标题偏场景化，突出使用场景、适用人群和核心利益点，但不要虚构商品没有的功能。',
  },
  minimal: {
    label: '保留定位',
    desc: '只做合规化和去噪，尽量不改变原商品定位。',
    prompt: '尽量保留原商品定位，只做合规化和去噪。标题要简洁稳妥，不要加入过多营销词，不要改变商品本质。',
  },
};

export function buildTitleMessages(p: Pick<Product, 'title' | 'attrs' | 'skus'>, profile: CleanProfile, max: number): Msg[] {
  const attrLines = Object.entries(p.attrs).slice(0, 12).map(([k, v]) => `- ${k}：${v}`);
  const specs = p.skus.slice(0, 8).map((s) => s.name).join('、');
  const info = [`原标题：${p.title}`, attrLines.length ? `商品属性：\n${attrLines.join('\n')}` : '', specs ? `规格：${specs}` : ''].filter(Boolean).join('\n');
  return [
    {
      role: 'system',
      content: [
        '你是电商商家的商品文案助手。任务：根据下面的商品信息，为商家写一条用于拼多多的商品标题。',
        PROFILE_TEXT[profile].prompt,
        '要求：',
        '1. 只使用给出的信息，不要添加原信息里没有的材质、功能、认证、品牌；',
        '2. 突出 1 到 2 个核心卖点（材质、规格、适用场景）；',
        '3. 通顺自然，不堆砌关键词，不用「最」「第一」「顶级」「国家级」这类绝对化用语，不用批发、代发、厂家等批发语境的词；',
        `4. 不超过 ${max} 个汉字；`,
        '5. 只输出新标题这一行，不要引号、序号和说明。',
      ].join('\n'),
    },
    { role: 'user', content: `${info}\n\n请写一条新的商品标题。` },
  ];
}

export function parseTitleReply(text: string, max: number): string {
  const first = (text ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const t = normalizeText(first.replace(/^(新?标题|商品标题)[:：]\s*/, '').replace(/^["“”'‘’「」『』`]+|["“”'‘’「」『』`]+$/g, ''));
  return clampChars(t, max);
}

export async function optimizeTitle(p: Pick<Product, 'title' | 'attrs' | 'skus'>, chat: ChatFn, profile: CleanProfile, max: number): Promise<string> {
  const reply = await chat(buildTitleMessages(p, profile, max), { temperature: 0.8 });
  const t = parseTitleReply(reply, max);
  if (!t) throw new Error('大模型没有返回可用的标题');
  return t;
}

/** 针对一件商品提问（例如「这个适合什么人群」「帮我想三个卖点」）。只做文字问答，不会替你操作任何页面。 */
export async function askAboutProduct(p: Pick<Product, 'title' | 'attrs' | 'skus' | 'description'>, question: string, chat: ChatFn): Promise<string> {
  const attrLines = Object.entries(p.attrs).slice(0, 15).map(([k, v]) => `${k}：${v}`).join('；');
  return chat([
    { role: 'system', content: '你是拼多多商家的运营助手，回答要简短实用。只根据给出的商品信息回答，信息里没有的就说不确定，不要编造。' },
    { role: 'user', content: `商品标题：${p.title}\n属性：${attrLines || '无'}\n规格：${p.skus.slice(0, 8).map((s) => s.name).join('、') || '无'}\n\n问题：${question}` },
  ]);
}
