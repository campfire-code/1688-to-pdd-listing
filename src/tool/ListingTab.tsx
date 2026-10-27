// 上架：在应用自带的拼多多窗口里登录，工具按步骤填表、传主图，默认只保存草稿。
import { useRef, useState } from 'react';
import { LogIn, LogOut, Play, ShieldAlert, Square } from 'lucide-react';
import { errText, type AppCtx } from './app';
import { tauriBridge } from './bridge';
import { inTauri } from './env';
import { listOne } from './listing';
import { buildPlan } from './plan';

export function ListingTab({ app }: { app: AppCtx }) {
  const { env, products, selected, settings } = app;
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const abort = useRef<AbortController | null>(null);
  const chosen = products.filter((p) => selected.has(p.id));
  const plans = chosen.map((p) => ({ p, plan: buildPlan(p, settings) }));
  const ready = plans.filter((x) => x.plan.blockers.length === 0);

  const invoke = async (cmd: string, args?: Record<string, unknown>) => {
    if (!inTauri) return app.setNotice({ kind: 'err', text: '预览模式下不能打开拼多多窗口' });
    try {
      const { invoke: inv } = await import('@tauri-apps/api/core');
      await inv(cmd, args);
    } catch (e) { app.setNotice({ kind: 'err', text: errText(e) }); }
  };

  const run = async (mode: 'draft' | 'submit') => {
    if (!env || !inTauri) return app.setNotice({ kind: 'err', text: '预览模式下不能上架' });
    if (!ready.length) return app.setNotice({ kind: 'err', text: '没有可上架的商品：先在产品库里勾选商品，并处理好「需要处理」的问题' });
    const { invoke: inv } = await import('@tauri-apps/api/core');
    if (!(await inv<boolean>('pdd_window_open'))) return app.setNotice({ kind: 'err', text: '请先点「打开拼多多窗口」，登录商家后台后再开始' });
    const { ask } = await import('@tauri-apps/plugin-dialog');
    const bridge = await tauriBridge();
    abort.current = new AbortController();
    setRunning(true);
    setResults({});
    app.setNotice(null);
    let okN = 0;
    for (const [i, { p, plan }] of ready.entries()) {
      if (abort.current.signal.aborted) break;
      app.say(`—— 第 ${i + 1}/${ready.length} 件：${plan.title}`);
      const res = await listOne(plan, {
        bridge, settings, mode, signal: abort.current.signal, log: (m) => app.say(`  ${m}`),
        readImage: (rel) => env.io.readBytes(env.lib.imagePath(p, rel)),
        confirmSubmit: async (pl) => ask(`即将提交上架：\n\n${pl.title}\n拼单价 ¥${Math.min(...pl.sku.rows.filter((r) => !r.filler).map((r) => r.group))} 起，${pl.sku.rows.length} 个规格\n\n提交后商品会进入拼多多审核并可能直接上架，请确认标题、类目、价格和图片都没问题，且你有权使用这些图文。`, { title: '确认提交上架', kind: 'warning', okLabel: '确认提交', cancelLabel: '取消' }),
      });
      const next = { ...p, updatedAt: Date.now(), lastError: res.ok ? '' : res.error ?? '', status: res.ok ? (res.done ? (mode === 'draft' ? 'drafted' : 'submitted') : p.status) : ('failed' as const) };
      await env.lib.save(next);
      setResults((r) => ({ ...r, [p.id]: { ok: res.ok, text: res.ok ? res.note ?? '完成' : `失败（${res.stage}）：${res.error}` } }));
      app.say(res.ok ? `  ✓ ${res.note ?? '完成'}` : `  ✗ 失败（${res.stage}）：${res.error}`);
      if (res.ok && res.done) okN++;
      await app.reload();
    }
    setRunning(false);
    app.setNotice({ kind: okN === ready.length ? 'ok' : 'err', text: `${mode === 'draft' ? '保存草稿' : '提交上架'}：成功 ${okN}/${ready.length}。草稿请到拼多多商家后台的草稿箱核对。` });
  };

  return (
    <div className="pp-cols">
      <aside className="k-panel pp-side k-scroll">
        <section className="pp-sec">
          <b>1. 登录拼多多商家后台</b>
          <p className="k-muted pp-p">在应用自带的窗口里登录。登录状态只保存在本应用里，不读取、不同步你的 Chrome。遇到扫码、短信、滑块、真人验证，请你自己在窗口里完成，工具会等你。</p>
          <div className="pp-btns">
            <button className="k-btn primary" onClick={() => invoke('open_pdd')}><LogIn size={14} />打开拼多多窗口</button>
            <button className="k-btn ghost" title="清除本应用里保存的拼多多登录状态" onClick={() => invoke('clear_pdd_login')}><LogOut size={14} />退出登录</button>
          </div>
        </section>
        <section className="pp-sec">
          <b>2. 要上架的商品（{chosen.length}）</b>
          <p className="k-muted pp-p">在「产品库」里勾选。下面显示每件商品上架前的检查结果。</p>
          <ul className="pp-checks">
            {plans.length === 0 && <li className="k-muted">还没有勾选商品</li>}
            {plans.map(({ p, plan }) => (
              <li key={p.id}>
                <span className={`k-st ${plan.blockers.length ? 'err' : plan.warnings.length ? 'warn' : 'ok'}`}>{plan.blockers.length ? '不能上架' : plan.warnings.length ? '有提醒' : '可上架'}</span>
                <span className="k-ellipsis">{plan.title || p.title}</span>
                {plan.blockers.length > 0 && <small className="pp-flag err">{plan.blockers.join('；')}</small>}
              </li>
            ))}
          </ul>
        </section>
        <section className="pp-sec">
          <b>3. 开始</b>
          <div className="pp-mode"><ShieldAlert size={14} />当前为「只保存草稿」。草稿不会对外展示，你在后台核对后自己点提交。</div>
          <div className="pp-btns">
            <button className="k-btn primary" disabled={running || !ready.length} onClick={() => run('draft')}><Play size={14} />保存草稿（{ready.length} 件）</button>
            {running && <button className="k-btn" onClick={() => abort.current?.abort()}><Square size={14} />停止</button>}
          </div>
          {settings.allowSubmit ? (
            <div className="pp-submit">
              <p className="pp-flag warn">已在设置里允许「提交上架」。每件商品提交前都会再确认一次。</p>
              <button className="k-btn" disabled={running || !ready.length} onClick={() => run('submit')}>提交上架…</button>
            </div>
          ) : (
            <small className="k-muted">「提交上架」默认关闭；需要时到「规则与设置」里打开。</small>
          )}
        </section>
      </aside>
      <main className="pp-main k-scroll">
        <section className="k-panel pp-card">
          <h3>进度与结果</h3>
          {Object.keys(results).length === 0 && !running && <p className="k-muted">还没有开始。登录后点「保存草稿」。</p>}
          {plans.filter(({ p }) => results[p.id]).map(({ p, plan }) => (
            <div key={p.id} className="pp-result">
              <span className={`k-st ${results[p.id].ok ? 'ok' : 'err'}`}>{results[p.id].ok ? '完成' : '失败'}</span>
              <b className="k-ellipsis">{plan.title || p.title}</b>
              <small className="k-muted">{results[p.id].text}</small>
            </div>
          ))}
        </section>
        <section className="k-panel pp-card">
          <h3>操作记录</h3>
          {app.log.length === 0 ? <p className="k-muted">暂无</p> : <ul className="pp-log">{app.log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </section>
        <section className="k-panel pp-card">
          <h3>注意</h3>
          <ul className="pp-notes">
            <li>采集和上架他人商品的图文可能侵权，请确认你有权使用；自动操作商家后台可能违反平台规则，风险自负。</li>
            <li>页面按文字和输入框提示语定位，拼多多后台改版后可能失效；失效时会在记录里写明停在哪一步，不会乱点。</li>
            <li>类目搜不到唯一结果时，默认暂停，等你在窗口里自己选好并点「下一步」。</li>
            <li>详情图目前不会自动上传到商品详情，请用「导出数据包」里的图片文件夹手动添加。</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
