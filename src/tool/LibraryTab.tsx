// 产品库：采集来的商品列表，右边编辑上架标题、类目、品牌、属性，预览规格组合和价格。
import { useEffect, useMemo, useState } from 'react';
import { Bot, FileDown, ImageDown, Puzzle, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { chat, llmReady, useSettings } from '../kit/settings';
import { pickFiles } from '../kit/platform';
import { errText, statusLabel, type AppCtx } from './app';
import { cleanTitle } from './clean';
import { attrsToKv, parseAttrKv } from './import';
import { parsePayloadFile } from './library';
import { askAboutProduct, optimizeTitle, PROFILE_TEXT } from './llm';
import { buildPlan } from './plan';
import { thumbSrc } from './thumb';
import type { CleanProfile, Product } from './types';

export function LibraryTab({ app }: { app: AppCtx }) {
  const { env, products, selected, settings } = app;
  const llm = useSettings().llm;
  const [q, setQ] = useState('');
  const shown = useMemo(() => products.filter((p) => !q || `${p.title}${p.cleanTitle}${p.id}`.includes(q)), [products, q]);
  const active = products.find((p) => p.id === app.activeId) ?? null;
  const ids = [...selected].filter((id) => products.some((p) => p.id === id));
  const allOn = shown.length > 0 && shown.every((p) => selected.has(p.id));
  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); app.setSelected(n); };

  const importFiles = async () => {
    if (!env) return;
    const paths = await pickFiles(['json'], '插件采集数据').catch(() => [] as string[]);
    if (!paths.length) return;
    app.setBusy('导入中…');
    let n = 0;
    try {
      for (const f of paths) {
        for (const payload of parsePayloadFile(await env.io.readText(f))) {
          const { product } = await env.lib.upsertFromPayload(payload, settings);
          const done = settings.autoDownload ? await env.lib.downloadImages(product.id, env.fetcher, { force: true }) : product;
          app.say(`已导入：${done.cleanTitle}（主图 ${done.localMain.length} 张）`);
          n++;
        }
      }
      app.setNotice({ kind: 'ok', text: `导入了 ${n} 件商品` });
    } catch (e) {
      app.setNotice({ kind: 'err', text: errText(e) });
    }
    app.setBusy('');
    await app.reload();
  };

  const downloadAll = async () => {
    if (!env || !ids.length) return;
    app.setBusy('下载图片…');
    let bad = 0;
    for (const id of ids) {
      try {
        const p = await env.lib.downloadImages(id, env.fetcher, { force: true });
        app.say(`${p.cleanTitle}：主图 ${p.localMain.length}/${p.mainImages.length}，详情图 ${p.localDetail.length}/${p.detailImages.length}`);
        if (!p.localMain.length) bad++;
      } catch (e) { bad++; app.say(`下载失败：${errText(e)}`); }
    }
    app.setBusy('');
    app.setNotice(bad ? { kind: 'err', text: `${bad} 件商品的主图没下载成功，原因见下方记录（常见：图片链接已失效、需要先在浏览器里登录）` } : { kind: 'ok', text: '图片下载完成' });
    await app.reload();
  };

  const optimizeAll = async () => {
    if (!env || !ids.length) return;
    if (!llmReady(llm)) return app.setNotice({ kind: 'err', text: '还没有设置大模型：到左侧「设置」页填写接口地址、密钥和模型名' });
    app.setBusy('标题优化…');
    let ok = 0;
    for (const id of ids) {
      const p = await env.lib.get(id);
      if (!p) continue;
      try {
        const t = await optimizeTitle(p, chat, settings.cleanProfile, settings.titleMax);
        await env.lib.save({ ...p, cleanTitle: t, updatedAt: Date.now() });
        app.say(`标题：${t}`);
        ok++;
      } catch (e) { app.say(`「${p.cleanTitle}」优化失败：${errText(e)}`); }
    }
    app.setBusy('');
    app.setNotice({ kind: ok === ids.length ? 'ok' : 'err', text: `优化了 ${ok}/${ids.length} 个标题，请逐个看一眼再上架` });
    await app.reload();
  };

  const removeSelected = async () => {
    if (!env || !ids.length) return;
    const { ask } = await import('@tauri-apps/plugin-dialog');
    if (!(await ask(`删除选中的 ${ids.length} 件商品？本地图片和数据会一起删除，不可恢复。`, { title: '删除商品', kind: 'warning' }))) return;
    for (const id of ids) await env.lib.remove(id);
    app.setSelected(new Set());
    if (app.activeId && ids.includes(app.activeId)) app.setActiveId(null);
    await app.reload();
  };

  return (
    <div className="pp-lib">
      <section className="pp-list k-panel">
        <div className="pp-toolbar">
          <input className="k-input pp-search" placeholder="搜索标题或编号" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="k-btn" disabled={!!app.busy} onClick={importFiles}><FileDown size={14} />导入采集文件</button>
          <button className="k-btn" disabled={!!app.busy || !ids.length} onClick={downloadAll}><ImageDown size={14} />下载图片</button>
          <button className="k-btn" disabled={!!app.busy || !ids.length} onClick={optimizeAll} title={llmReady(llm) ? '用你设置的大模型改写标题' : '需要先在「设置」页填写大模型'}><Sparkles size={14} />标题优化</button>
          <button className="k-btn ghost" disabled={!!app.busy || !ids.length} onClick={removeSelected}><Trash2 size={14} />删除</button>
          {app.busy && <span className="k-muted">{app.busy}</span>}
        </div>
        {products.length === 0 ? (
          <div className="pp-empty k-muted">
            <Puzzle size={30} />
            <p>产品库是空的。<br />装好「采集插件」，在 1688、淘宝或天猫的商品页点「采集当前商品」，商品会自动出现在这里。</p>
            <button className="k-btn primary" onClick={() => app.goto('plugin')}>去安装采集插件</button>
          </div>
        ) : (
          <div className="pp-tablewrap k-scroll">
            <table className="k-table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="全选" checked={allOn} onChange={() => app.setSelected(allOn ? new Set() : new Set(shown.map((p) => p.id)))} /></th>
                  <th>商品</th><th>进价</th><th>拼单价</th><th>规格</th><th>状态</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const plan = buildPlan(p, settings);
                  const [label, cls] = statusLabel[p.status];
                  const src = thumbSrc(env, p);
                  const prices = plan.sku.rows.filter((r) => !r.filler).map((r) => r.group);
                  return (
                    <tr key={p.id} className={p.id === app.activeId ? 'sel' : ''} onClick={() => app.setActiveId(p.id)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`选择 ${p.cleanTitle}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                      <td>
                        <div className="pp-prod">
                          {src ? <img className="pp-thumb" src={src} alt="" /> : <span className="pp-thumb pp-nothumb" />}
                          <div className="pp-prod-text">
                            <b className="k-ellipsis">{plan.title || p.title}</b>
                            <small className="k-muted">{p.platform === '1688' ? '1688' : p.platform === 'other' ? '其他' : p.platform === 'tmall' ? '天猫' : '淘宝'} · {p.id}</small>
                          </div>
                        </div>
                      </td>
                      <td className="k-num">{p.cost !== null ? `¥${p.cost}` : '—'}</td>
                      <td className="k-num">{prices.length ? `¥${Math.min(...prices)}${Math.max(...prices) > Math.min(...prices) ? '起' : ''}` : '—'}</td>
                      <td className="k-num">{p.skus.length}</td>
                      <td><span className={`k-st ${cls}`} title={p.lastError || undefined}>{label}</span>{plan.blockers.length > 0 && <span className="k-st warn pp-gap" title={plan.blockers.join('；')}>{plan.blockers.length} 个问题</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="pp-foot k-muted">已选 {ids.length} 件 · 共 {products.length} 件 · 数据保存在本机，不上传</div>
      </section>
      {active && <Editor key={active.id} app={app} p={active} />}
    </div>
  );
}

function Editor({ app, p }: { app: AppCtx; p: Product }) {
  const { env, settings } = app;
  const llm = useSettings().llm;
  const [d, setD] = useState({ cleanTitle: p.cleanTitle, categoryPath: p.categoryPath, brand: p.brand, attrs: attrsToKv(p.attrs), note: p.note });
  const [ask, setAsk] = useState('');
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState(false);
  useEffect(() => setD({ cleanTitle: p.cleanTitle, categoryPath: p.categoryPath, brand: p.brand, attrs: attrsToKv(p.attrs), note: p.note }), [p]);
  const draft: Product = { ...p, cleanTitle: d.cleanTitle, categoryPath: d.categoryPath, brand: d.brand, attrs: parseAttrKv(d.attrs), note: d.note };
  const plan = buildPlan(draft, settings);
  const dirty = JSON.stringify([p.cleanTitle, p.categoryPath, p.brand, p.attrs, p.note]) !== JSON.stringify([draft.cleanTitle, draft.categoryPath, draft.brand, draft.attrs, draft.note]);
  const len = Array.from(d.cleanTitle).length;

  const run = async (fn: () => Promise<void>) => {
    setThinking(true);
    try { await fn(); } catch (e) { app.setNotice({ kind: 'err', text: errText(e) }); }
    setThinking(false);
  };

  return (
    <aside className="pp-editor k-panel k-scroll">
      <h3 className="pp-h">编辑上架信息</h3>
      <p className="k-muted pp-orig">原标题：{p.title}</p>
      <div className="k-field">
        <label className="k-label" htmlFor="pp-title">上架标题 <span className={`k-num ${len > settings.titleMax ? 'pp-over' : 'k-muted'}`}>{len}/{settings.titleMax}</span></label>
        <input id="pp-title" className="k-input" value={d.cleanTitle} onChange={(e) => setD({ ...d, cleanTitle: e.target.value })} />
        <div className="pp-btns">
          <button className="k-btn ghost" onClick={() => setD({ ...d, cleanTitle: cleanTitle(p.title, settings.titleMax) })}><Wand2 size={13} />按规则清洗</button>
          <button className="k-btn ghost" disabled={thinking} title={llmReady(llm) ? '' : '需要先在「设置」页填写大模型'} onClick={() => run(async () => {
            if (!llmReady(llm)) throw new Error('还没有设置大模型：到左侧「设置」页填写接口地址、密钥和模型名');
            setD({ ...d, cleanTitle: await optimizeTitle(p, chat, settings.cleanProfile, settings.titleMax) });
          })}><Sparkles size={13} />{thinking ? '生成中…' : '大模型优化'}</button>
        </div>
      </div>
      <div className="k-field">
        <label className="k-label" htmlFor="pp-cat">目标类目（可选）</label>
        <input id="pp-cat" className="k-input" value={d.categoryPath} placeholder="男装 > T恤 > T恤" onChange={(e) => setD({ ...d, categoryPath: e.target.value })} />
        <span className="k-help">用「&gt;」分层，和拼多多后台显示的类目一致时会自动选中；留空则用标题里的品类词「{plan.keyword}」搜索。</span>
      </div>
      <div className="k-field">
        <label className="k-label" htmlFor="pp-brand">品牌</label>
        <input id="pp-brand" className="k-input" value={d.brand} placeholder="留空则不填品牌" onChange={(e) => setD({ ...d, brand: e.target.value })} />
      </div>
      <div className="k-field">
        <label className="k-label" htmlFor="pp-attrs">商品属性（每行「名称:值」）</label>
        <textarea id="pp-attrs" className="k-input k-textarea" rows={4} value={d.attrs} onChange={(e) => setD({ ...d, attrs: e.target.value })} />
      </div>
      <div className="k-field">
        <label className="k-label" htmlFor="pp-note">备注</label>
        <input id="pp-note" className="k-input" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
      </div>
      <div className="pp-btns">
        <button className="k-btn primary" disabled={!dirty} onClick={() => app.save(draft)}>保存修改</button>
        {env && p.sourceUrl && <button className="k-btn ghost" onClick={async () => (await import('../kit/platform')).openLink(p.sourceUrl)}>打开来源页</button>}
      </div>

      <h3 className="pp-h">规格与价格预览</h3>
      {plan.sku.specs.length > 0 && <p className="k-muted pp-p">规格类型：{plan.sku.specs.map((s) => `${s.name}（${s.values.length} 个值）`).join('、')}</p>}
      <div className="k-table-wrap">
        <table className="k-table pp-sku">
          <thead><tr><th>规格组合</th><th>进价</th><th>拼单价</th><th>单买价</th><th>库存</th></tr></thead>
          <tbody>
            {plan.sku.rows.slice(0, 12).map((r, i) => (
              <tr key={i} className={r.filler ? 'pp-filler' : ''}>
                <td>{r.combo.join(' + ') || '默认'}</td><td className="k-num">{r.cost || '—'}</td><td className="k-num">{r.group}</td><td className="k-num">{r.single}</td><td className="k-num">{r.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.sku.rows.length > 12 && <small className="k-muted">只显示前 12 行，共 {plan.sku.rows.length} 行</small>}
      {[...plan.blockers.map((t) => ['err', t] as const), ...plan.warnings.map((t) => ['warn', t] as const)].map(([k, t], i) => (
        <p key={i} className={`pp-flag ${k}`}>{k === 'err' ? '需要处理：' : '提醒：'}{t}</p>
      ))}

      <h3 className="pp-h"><Bot size={14} /> 问助手</h3>
      <p className="k-muted pp-p">用你设置的大模型回答关于这件商品的问题（只做文字问答，不会替你操作页面）。</p>
      <div className="pp-ask">
        <input className="k-input" value={ask} placeholder="例如：帮我想三个卖点" onChange={(e) => setAsk(e.target.value)} />
        <button className="k-btn" disabled={thinking || !ask.trim()} onClick={() => run(async () => {
          if (!llmReady(llm)) throw new Error('还没有设置大模型：到左侧「设置」页填写接口地址、密钥和模型名');
          setAnswer(await askAboutProduct(p, ask, chat));
        })}>提问</button>
      </div>
      {answer && <p className="pp-answer">{answer}</p>}
      <p className="k-muted pp-p">{PROFILE_TEXT[settings.cleanProfile as CleanProfile].label}风格：{PROFILE_TEXT[settings.cleanProfile as CleanProfile].desc}</p>
    </aside>
  );
}
