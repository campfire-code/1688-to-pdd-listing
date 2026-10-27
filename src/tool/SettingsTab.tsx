// 规则与设置：定价、标题、规格类型名、上架行为。大模型接口在左侧导航的「设置」页里填。
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { llmReady, useSettings } from '../kit/settings';
import { openFolder } from '../kit/platform';
import type { AppCtx } from './app';
import { PROFILE_TEXT } from './llm';
import type { CleanProfile, ToolSettings } from './types';

const PROMISE_OPTIONS = ['正品发票', '假一赔十'];

function Num({ label, value, onChange, min, max, step, unit, help }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; help?: string }) {
  const [text, setText] = useState(String(value));
  return (
    <div className="k-field">
      <label className="k-label">{label}</label>
      <span className="k-input-wrap">
        <input className="k-input" type="number" min={min} max={max} step={step ?? 1} value={text} onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) onChange(n); }} onBlur={() => setText(String(value))} />
        {unit && <span className="k-unit">{unit}</span>}
      </span>
      {help && <span className="k-help">{help}</span>}
    </div>
  );
}

export function SettingsTab({ app }: { app: AppCtx }) {
  const { settings: s, setSettings, env } = app;
  const llm = useSettings().llm;
  const set = (patch: Partial<ToolSettings>) => setSettings(patch);
  return (
    <div className="pp-settings k-scroll">
      <section className="k-panel pp-card">
        <h3>价格与库存</h3>
        <div className="pp-grid">
          <Num label="拼单价 = 进价 ×" value={s.groupMultiplier} min={0.1} max={100} step={0.05} onChange={(v) => set({ groupMultiplier: v })} help="默认 1.5（沿用参考实现）" />
          <Num label="单买价 = 进价 ×" value={s.singleMultiplier} min={0.1} max={100} step={0.05} onChange={(v) => set({ singleMultiplier: v })} help="默认 1.85。单买价必须高于拼单价，否则自动按拼单价上浮 15%" />
          <Num label="每个规格的库存" value={s.defaultStock} min={0} max={99999} onChange={(v) => set({ defaultStock: v })} help="不沿用 1688 的库存" unit="件" />
        </div>
      </section>
      <section className="k-panel pp-card">
        <h3>标题与规格</h3>
        <div className="pp-grid">
          <Num label="标题最多字数" value={s.titleMax} min={10} max={60} onChange={(v) => set({ titleMax: v })} help="默认 30（沿用参考实现），实际限制以拼多多为准" unit="字" />
          <div className="k-field">
            <label className="k-label">标题优化风格（大模型）</label>
            <select className="k-input" value={s.cleanProfile} onChange={(e) => set({ cleanProfile: e.target.value as CleanProfile })}>
              {(Object.keys(PROFILE_TEXT) as CleanProfile[]).map((k) => <option key={k} value={k}>{PROFILE_TEXT[k].label}</option>)}
            </select>
            <span className="k-help">{PROFILE_TEXT[s.cleanProfile].desc}</span>
          </div>
          <div className="k-field">
            <label className="k-label">第一个规格类型</label>
            <input className="k-input" value={s.specTypeNames[0]} onChange={(e) => set({ specTypeNames: [e.target.value, s.specTypeNames[1]] })} />
            <span className="k-help">要和拼多多后台规格类型下拉里的名字一致，如「颜色」「款式」</span>
          </div>
          <div className="k-field">
            <label className="k-label">第二个规格类型</label>
            <input className="k-input" value={s.specTypeNames[1]} onChange={(e) => set({ specTypeNames: [s.specTypeNames[0], e.target.value] })} />
            <span className="k-help">如「尺寸」「规格」；拼多多最多 2 个规格类型</span>
          </div>
        </div>
        <label className="k-toggle"><input type="checkbox" checked={s.autoDownload} onChange={(e) => set({ autoDownload: e.target.checked })} /><span>采集到商品后自动下载主图和详情图</span></label>
      </section>
      <section className="k-panel pp-card">
        <h3>发货与承诺</h3>
        <div className="pp-grid">
          <div className="k-field">
            <label className="k-label">发货时效</label>
            <select className="k-input" value={s.shipTime} onChange={(e) => set({ shipTime: e.target.value })}>
              {['24小时发货及揽收', '48小时发货及揽收', ''].map((v) => <option key={v} value={v}>{v || '不自动选择'}</option>)}
            </select>
          </div>
          <div className="k-field">
            <label className="k-label">开票方式</label>
            <input className="k-input" value={s.invoiceMode} onChange={(e) => set({ invoiceMode: e.target.value })} />
            <span className="k-help">表单里必填项的文字，如「每单必开」；留空则不选</span>
          </div>
          <div className="k-field">
            <label className="k-label">物流模板（写进数据包）</label>
            <input className="k-input" value={s.logisticsTemplate} placeholder="默认运费模板" onChange={(e) => set({ logisticsTemplate: e.target.value })} />
          </div>
        </div>
        <div className="k-field">
          <label className="k-label">自动勾选的承诺（默认都不勾）</label>
          <div className="k-multi">
            {PROMISE_OPTIONS.map((o) => (
              <label key={o} className={`k-chip${s.promises.includes(o) ? ' on' : ''}`}>
                <input type="checkbox" hidden checked={s.promises.includes(o)} onChange={(e) => set({ promises: e.target.checked ? [...s.promises, o] : s.promises.filter((x) => x !== o) })} />{o}
              </label>
            ))}
          </div>
          <span className="k-help">勾选就是以你的店铺名义向买家做出这项承诺，请只勾你能兑现的。</span>
        </div>
      </section>
      <section className="k-panel pp-card">
        <h3>上架行为</h3>
        <div className="k-field">
          <label className="k-label">类目搜不到唯一结果时</label>
          <div className="k-seg" role="radiogroup" aria-label="类目不确定时">
            <button role="radio" aria-checked={s.uncertainCategory === 'pause'} className={s.uncertainCategory === 'pause' ? 'on' : ''} onClick={() => set({ uncertainCategory: 'pause' })}>暂停，我自己选（推荐）</button>
            <button role="radio" aria-checked={s.uncertainCategory === 'best'} className={s.uncertainCategory === 'best' ? 'on' : ''} onClick={() => set({ uncertainCategory: 'best' })}>自动选最相近的</button>
          </div>
        </div>
        <div className="pp-danger">
          <label className="k-toggle"><input type="checkbox" checked={s.allowSubmit} onChange={(e) => set({ allowSubmit: e.target.checked })} /><span><b>允许「提交上架」</b>（默认关闭）</span></label>
          <p className="pp-flag warn"><ShieldAlert size={13} /> 打开后，「上架」页会多出「提交上架」按钮，提交会让商品进入拼多多审核并可能直接上架。即使打开，每件商品提交前也会再弹窗确认一次。建议先保存草稿，在后台核对后再自己提交。</p>
        </div>
      </section>
      <section className="k-panel pp-card">
        <h3>大模型与数据位置</h3>
        <p className="k-muted pp-p">大模型（标题优化、问助手）用左侧导航里「设置」页填的接口地址、密钥和模型名，兼容 OpenAI 接口格式；密钥只保存在本机。当前状态：{llmReady(llm) ? `已设置（${llm.model}）` : '未设置'}。</p>
        <p className="k-muted pp-p">产品库位置：<code>{env?.root ?? '…'}</code></p>
        {env && !env.preview && <button className="k-btn" onClick={() => openFolder(env.root)}>打开产品库文件夹</button>}
      </section>
    </div>
  );
}
