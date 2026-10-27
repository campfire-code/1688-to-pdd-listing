// 大模型部分：用假函数代替真实接口，不访问网络。
import { describe, expect, it } from 'vitest';
import { askAboutProduct, buildTitleMessages, optimizeTitle, parseTitleReply, PROFILE_TEXT } from './llm';
import { normalizeSettings } from './settings';
import { DEFAULT_SETTINGS } from './types';

const p = { title: '示例·304不锈钢保温杯 厂家直销', attrs: { 材质: '304不锈钢', 容量: '500ml' }, skus: [{ name: '黑 > 500ml' }, { name: '白 > 500ml' }], description: '' };

describe('标题优化', () => {
  it('提示词：带上原标题、属性、规格、字数上限和风格，要求不虚构、不用绝对化用语', () => {
    const m = buildTitleMessages(p, 'scene', 30);
    expect(m[0].content).toContain('不超过 30 个汉字');
    expect(m[0].content).toContain(PROFILE_TEXT.scene.prompt);
    expect(m[0].content).toContain('不要添加原信息里没有的');
    expect(m[0].content).toContain('绝对化');
    expect(m[1].content).toContain('原标题：示例·304不锈钢保温杯');
    expect(m[1].content).toContain('材质：304不锈钢');
    expect(m[1].content).toContain('黑 > 500ml');
  });
  it('解析回复：取第一行，去引号、「标题：」前缀，按字数截断', () => {
    expect(parseTitleReply('「304不锈钢保温杯 大容量」\n说明：……', 30)).toBe('304不锈钢保温杯 大容量');
    expect(parseTitleReply('标题：“便携保温杯”', 30)).toBe('便携保温杯');
    expect(parseTitleReply('一二三四五六七八九十', 4)).toBe('一二三四');
    expect(parseTitleReply('', 30)).toBe('');
  });
  it('调用：用传入的聊天函数，返回清洗后的标题；空回复报错', async () => {
    const seen: unknown[] = [];
    const t = await optimizeTitle(p, async (_m, o) => { seen.push(o); return '「便携304保温杯」'; }, 'marketplace', 30);
    expect(t).toBe('便携304保温杯');
    expect(seen[0]).toMatchObject({ temperature: 0.8 });
    await expect(optimizeTitle(p, async () => '  ', 'marketplace', 30)).rejects.toThrow('没有返回可用的标题');
  });
  it('问助手：只传商品信息和问题', async () => {
    let got = '';
    const a = await askAboutProduct(p, '帮我想三个卖点', async (m) => { got = m.map((x) => x.content).join('\n'); return '1. 保温'; });
    expect(a).toBe('1. 保温');
    expect(got).toContain('帮我想三个卖点');
    expect(got).toContain('不要编造');
  });
});

describe('设置规整', () => {
  it('缺的补默认，超出范围的拉回，类型不对的丢掉', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = normalizeSettings({ titleMax: 999, groupMultiplier: -1, defaultStock: 12.6, allowSubmit: 'yes' as never, uncertainCategory: 'x' as never, cleanProfile: 'scene', promises: ['假一赔十', '', 5 as never], specTypeNames: ['颜色', ''] as never });
    expect(s).toMatchObject({ titleMax: 60, groupMultiplier: 0.1, defaultStock: 13, allowSubmit: false, uncertainCategory: 'pause', cleanProfile: 'scene', promises: ['假一赔十'], specTypeNames: ['颜色', '尺寸'] });
  });
  it('提交上架默认关闭，承诺默认不勾', () => {
    expect(DEFAULT_SETTINGS.allowSubmit).toBe(false);
    expect(DEFAULT_SETTINGS.promises).toEqual([]);
    expect(DEFAULT_SETTINGS.uncertainCategory).toBe('pause');
  });
});
