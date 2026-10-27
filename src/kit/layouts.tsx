// 六套布局。工具代码不感知布局；布局由 tool.json 的 ui.layout 决定（汇总仓库按工具编号抽签写入）。
import { useEffect, useState, type ReactNode } from 'react';
import { Image as ImageIcon, Clock, KeyRound, Info, Trash2, Settings2, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import type { Field, LayoutId, ToolMeta } from './types';
import type { Row, Runner } from './runner';
import {
  AboutPage, AddButtons, BrandMark, visibleFields, DropZone, EmptyState, ExportAction, FieldControl, HistoryPage, Notice, ParamsPanel, PrimaryAction,
  ProgressBar, ResultText, RowActions, SettingsPage, StatusChip, Summary, Thumb, pct,
} from './parts';

export type Page = 'main' | 'history' | 'settings' | 'about';
export interface LayoutProps {
  runner: Runner;
  meta: ToolMeta;
  hover: boolean;
  page: Page;
  setPage: (p: Page) => void;
}

type IconType = Runner['tool']['icon'] | typeof ImageIcon;
const PAGES: [Page, string, NonNullable<IconType>][] = [
  ['main', '', ImageIcon],
  ['history', '处理记录', Clock],
  ['settings', '设置', KeyRound],
  ['about', '关于', Info],
];
const mainLabel = (r: Runner) => (r.tool.mode === 'batch' ? '批量处理' : r.tool.mode === 'generate' ? '生成' : r.tool.mainLabel ?? '主页');
/** 用不到大模型的工具不出现「设置」页，外观切换放在「关于」里 */
const pagesFor = (r: Runner) => PAGES.map(([p, l, I]) => [p, l, p === 'main' && r.tool.icon ? r.tool.icon : I] as typeof PAGES[number]).filter(([p]) => (p !== 'settings' || r.tool.needsLLM) && (p !== 'history' || r.tool.mode !== 'custom'));

function SubPage({ page, runner, meta }: { page: Page; runner: Runner; meta: ToolMeta }) {
  if (page === 'history') return <HistoryPage runner={runner} />;
  if (page === 'settings' && runner.tool.needsLLM) return <SettingsPage />;
  if (page === 'about') return <AboutPage meta={meta} tagline={runner.tool.tagline} withTheme={!runner.tool.needsLLM} />;
  return null;
}

/** 自定义型工具的主体 */
function CustomMain({ runner }: { runner: Runner }) {
  const t = runner.tool;
  if (t.mode !== 'custom') return null;
  return <div className="k-custom">{t.Main({ ctx: runner.ctx })}</div>;
}

/** 结果区：表格 / 文本类工具在所有布局里形态固定，其余由布局决定 */
function Results({ runner, variant, selected, onSelect }: { runner: Runner; variant: 'rows' | 'table' | 'cards' | 'compact'; selected?: string; onSelect?: (id: string) => void }) {
  const t = runner.tool;
  const v = t.resultView === 'table' ? 'table' : t.resultView === 'text' ? 'text' : variant;
  if (v === 'text') {
    return (
      <div className="k-texts">
        {runner.rows.map((r) => (
          <div key={r.item.id} className="k-text-card">
            <div className="k-text-head"><b>{r.result?.title ?? r.item.name}</b><StatusChip row={r} short /></div>
            {r.status === 'err' && <span className="k-err-text">{r.error}</span>}
            {t.ResultBody && r.status === 'ok' && r.result ? <t.ResultBody item={r.item} result={r.result} /> : <ResultText row={r} />}
          </div>
        ))}
      </div>
    );
  }
  if (v === 'table') {
    const cols = t.columns ?? [];
    return (
      <div className="k-table-wrap"><table className="k-table">
        <thead><tr><th>{t.mode === 'batch' ? '文件' : '序号'}</th>{cols.map(([k, l]) => <th key={k}>{l}</th>)}<th>状态</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {runner.rows.map((r) => (
            <tr key={r.item.id} className={selected === r.item.id ? 'sel' : ''} onClick={() => onSelect?.(r.item.id)}>
              <td><span className="k-name">{t.type === 'media' && <Thumb row={r} runner={runner} />}<span className="k-name-text"><span className="k-ellipsis" title={r.item.name}>{r.result?.title ?? r.item.name}</span>{r.status === 'err' && <small className="k-err-text" title={r.error}>{r.error}</small>}</span></span></td>
              {cols.map(([k]) => { const v = r.result?.row?.[k] ?? ''; return <td key={k} className="k-num k-cell" title={String(v)}>{v}</td>; })}
              <td><StatusChip row={r} short={cols.length > 2} /></td>
              <td><RowActions row={r} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    );
  }
  if (v === 'cards') {
    return (
      <div className="k-cards">
        {runner.rows.map((r) => (
          <div key={r.item.id} className={`k-card${selected === r.item.id ? ' sel' : ''}`} onClick={() => onSelect?.(r.item.id)}>
            {t.ResultBody && r.status === 'ok' && r.result ? <div className="k-card-body"><t.ResultBody item={r.item} result={r.result} /></div> : <Thumb row={r} runner={runner} />}
            <div className="k-card-meta"><span className="k-ellipsis" title={r.item.name}>{r.item.name}</span><span className="k-card-foot"><StatusChip row={r} short /><RowActions row={r} /></span></div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={`k-rows${v === 'compact' ? ' compact' : ''}`}>
      {runner.rows.map((r) => (
        <div key={r.item.id} className={`k-row${selected === r.item.id ? ' sel' : ''}`} onClick={() => onSelect?.(r.item.id)}>
          <Thumb row={r} runner={runner} />
          <div className="k-row-name"><span className="k-ellipsis" title={r.item.name}>{r.item.name}</span>{t.ResultBody && r.status === 'ok' && r.result && v !== 'compact' && <div className="k-row-body"><t.ResultBody item={r.item} result={r.result} /></div>}{v === 'compact' ? (r.status === 'ok' && r.result?.summary ? <small className="k-muted k-ellipsis">{r.result.summary}</small> : r.status === 'err' ? <small className="k-err-text k-ellipsis" title={r.error}>{r.error}</small> : null) : r.item.size != null && <small className="k-muted k-num">{(r.item.size / 1024).toFixed(0)} KB</small>}</div>
          <StatusChip row={r} short={v === 'compact' || (!!t.ResultBody && r.status === 'ok')} />
          <RowActions row={r} />
          {!runner.running && r.status !== 'run' && <button className="k-icon-btn" aria-label="移除" title="移除" onClick={(e) => { e.stopPropagation(); runner.remove(r.item.id); }}><Trash2 size={14} /></button>}
        </div>
      ))}
    </div>
  );
}

const Footer = ({ runner, children }: { runner: Runner; children?: ReactNode }) => (
  <>
    <Summary runner={runner} />
    <ProgressBar ratio={runner.stats.ratio} />
    {children}
  </>
);

// ---------- A 清爽蓝 · 侧边导航 ----------
function LayoutA({ runner, meta, hover, page, setPage }: LayoutProps) {
  const empty = !runner.rows.length;
  return (
    <div className="L-a">
      <nav className="a-side" aria-label="导航">
        <div className="a-brand"><span className="a-logo">{(() => { const I = runner.tool.icon ?? ImageIcon; return <I size={18} />; })()}</span><span className="a-brand-text"><span>{meta.name}</span><BrandMark /></span></div>
        {pagesFor(runner).map(([p, l, I]) => (
          <button key={p} className={`a-nav${page === p ? ' on' : ''}`} onClick={() => setPage(p)} aria-current={page === p}><I size={16} />{l || mainLabel(runner)}</button>
        ))}
      </nav>
      <main className="a-main">
        {page !== 'main' ? <SubPage page={page} runner={runner} meta={meta} /> : runner.tool.mode === 'custom' ? <CustomMain runner={runner} /> : (
          <>
            <header className="a-h"><h1>{mainLabel(runner)}</h1><AddButtons runner={runner} />{runner.tool.mode === 'batch' && <button className="k-btn" disabled={runner.running || empty} onClick={runner.clear}><Trash2 size={15} />清空</button>}</header>
            <Notice runner={runner} />
            <div className="a-grid">
              <section className="k-panel a-list">{empty ? <EmptyState runner={runner} hover={hover} /> : <><div className="a-list-hd"><Summary runner={runner} /></div><div className="k-scroll"><Results runner={runner} variant="rows" /></div></>}</section>
              <aside className="k-panel k-scroll"><ParamsPanel runner={runner} title="参数" /></aside>
            </div>
            <footer className="a-foot"><Footer runner={runner}><ExportAction runner={runner} /><PrimaryAction runner={runner} /></Footer></footer>
          </>
        )}
      </main>
    </div>
  );
}

// ---------- B 工作台 · 三栏紧凑 ----------
function LayoutB({ runner, meta, hover, page, setPage }: LayoutProps) {
  const [sel, setSel] = useState<string>();
  const row = runner.rows.find((r) => r.item.id === sel) ?? runner.rows[0];
  return (
    <div className="L-b">
      <div className="b-tool" role="toolbar" aria-label="工具栏">
        {page === 'main' && runner.tool.mode === 'custom' ? <b>{meta.name}</b> : page === 'main' ? (
          <>
            <AddButtons runner={runner} compact />
            {runner.tool.mode === 'batch' && <button className="k-btn" disabled={runner.running || !runner.rows.length} onClick={runner.clear}><Trash2 size={15} />清空</button>}
            <span className="b-sep" />
            <PrimaryAction runner={runner} />
            <ExportAction runner={runner} />
          </>
        ) : (
          <button className="k-btn" onClick={() => setPage('main')}><ChevronLeft size={15} />返回{mainLabel(runner)}</button>
        )}
        <span className="b-sp" />
        {pagesFor(runner).slice(1).map(([p, l, I]) => <button key={p} className={`k-btn ghost${page === p ? ' on' : ''}`} onClick={() => setPage(p)}><I size={15} />{l}</button>)}
      </div>
      {page !== 'main' ? <div className="b-page k-scroll"><SubPage page={page} runner={runner} meta={meta} /></div> : runner.tool.mode === 'custom' ? <div className="b-page k-scroll"><CustomMain runner={runner} /></div> : (
        <div className="b-body">
          <section className="b-table k-scroll">
            <Notice runner={runner} />
            {runner.rows.length ? <Results runner={runner} variant="table" selected={row?.item.id} onSelect={setSel} /> : <div className="b-empty"><EmptyState runner={runner} hover={hover} /></div>}
          </section>
          <aside className="b-insp k-scroll">
            {row && <div className="b-sec"><h2>选中：{row.item.name}</h2><Preview row={row} runner={runner} /></div>}
            <div className="b-sec"><h2>参数</h2><ParamsPanel runner={runner} /></div>
          </aside>
        </div>
      )}
      <div className="b-status">{runner.tool.mode !== 'custom' && <Footer runner={runner} />}<span className="b-sp" /><span className="k-muted">{meta.name} {meta.version}</span><BrandMark /></div>
    </div>
  );
}

function Preview({ row, runner }: { row: Row; runner: Runner }) {
  const Body = runner.tool.ResultBody;
  if (Body && row.status === 'ok' && row.result) return <div className="k-preview-meta"><StatusChip row={row} short /><Body item={row.item} result={row.result} /></div>;
  if (runner.tool.type === 'media') {
    const out = row.status === 'ok' && row.result?.preview;
    return (
      <div className="k-compare">
        <figure><Thumb row={row} runner={runner} done={false} /><figcaption>原图</figcaption></figure>
        <figure>{out ? <Thumb row={row} runner={runner} /> : <span className="k-thumb k-placeholder">{row.status === 'err' ? row.error : row.status === 'run' ? `处理中 ${pct(row.progress)}` : '处理后在这里显示'}</span>}<figcaption>结果</figcaption></figure>
      </div>
    );
  }
  return <div className="k-preview-meta"><StatusChip row={row} />{row.result?.text && <ResultText row={row} />}</div>;
}

// ---------- C 向导步骤 · 大卡片 ----------
function LayoutC({ runner, meta, hover, page, setPage }: LayoutProps) {
  const batch = runner.tool.mode === 'batch';
  const steps = batch ? ['添加文件', '设置效果', '批量处理', '查看结果'] : ['填写内容', '生成中', '查看结果'];
  const runStep = steps.length - 2;
  const [step, setStep] = useState(0);
  const view = runner.running ? runStep : step;
  useEffect(() => {
    if (!runner.running && step === runStep && runner.stats.total) setStep(runStep + 1);
  }, [runner.running, step, runStep, runner.stats.total]);
  const next = () => {
    if (view + 1 === runStep) { setStep(runStep); runner.start(); } else setStep(view + 1);
  };
  const genLabel = runner.tool.mode === 'generate' ? runner.tool.generateLabel ?? '开始生成' : '开始处理';
  if (runner.tool.mode === 'custom') {
    return (
      <div className="L-c">
        <div className="c-steps"><b className="c-title">{meta.name}</b><span className="c-sp" style={{ flex: 1 }} />{pagesFor(runner).map(([p, l, I]) => <button key={p} className={`k-btn ghost${page === p ? ' on' : ''}`} onClick={() => setPage(p)}><I size={15} />{l || mainLabel(runner)}</button>)}</div>
        <main className="c-body k-scroll">{page === 'main' ? <CustomMain runner={runner} /> : <SubPage page={page} runner={runner} meta={meta} />}</main>
        <footer className="c-foot"><span /><span className="k-muted c-mid"><BrandMark /></span><span /></footer>
      </div>
    );
  }
  return (
    <div className="L-c">
      <div className="c-steps">
        {steps.map((s, i) => (
          <span key={s} className="c-step-wrap">
            {i > 0 && <span className="c-line" />}
            <button className={`c-step${i < view ? ' done' : i === view && page === 'main' ? ' on' : ''}`} disabled={runner.running || i === runStep || (i > view && !(i === runStep + 1 && runner.stats.ok))} onClick={() => { setPage('main'); setStep(i); }}>
              <b>{i < view ? <Check size={14} /> : i + 1}</b>{s}
            </button>
          </span>
        ))}
        <span className="c-sp" />
        {pagesFor(runner).slice(1).map(([p, l, I]) => <button key={p} className={`k-btn ghost${page === p ? ' on' : ''}`} onClick={() => setPage(page === p ? 'main' : p)}><I size={15} />{l}</button>)}
      </div>
      <main className="c-body k-scroll">
        {page !== 'main' ? <SubPage page={page} runner={runner} meta={meta} /> : (
          <>
            <Notice runner={runner} />
            {batch && view === 0 && (
              <div className="c-card">
                <h1>{runner.tool.name}</h1><p className="k-muted">{runner.tool.tagline}</p>
                {runner.tool.Empty && !runner.rows.length && <EmptyState runner={runner} hover={hover} />}
                <DropZone runner={runner} hover={hover} big={!runner.tool.Empty} />
                {!!runner.rows.length && <><Summary runner={runner} /><Results runner={runner} variant="cards" /></>}
              </div>
            )}
            {view === runStep - 1 && (
              <div className="c-card"><h1>{batch ? '设置效果' : runner.tool.name}</h1>{!batch && <p className="k-muted">{runner.tool.tagline}</p>}<div className="c-params"><ParamsPanel runner={runner} /></div></div>
            )}
            {view >= runStep && (
              <div className="c-grid">
                <div className="c-card">
                  <h1>{runner.running ? '正在处理' : '处理完成'}</h1>
                  <div className="c-ring"><span className="r" style={{ ['--p' as string]: pct(runner.stats.ratio) }}><span className="k-num">{pct(runner.stats.ratio)}</span></span><div className="c-ring-text"><Summary runner={runner} />{runner.running && <span className="k-muted">处理中可以先做别的事</span>}</div></div>
                </div>
                <div className="c-card"><h1>本次设置</h1><dl className="c-kv">{visibleFields(runner).map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{display(f, runner.params[f.key])}</dd></div>)}</dl></div>
                <div className="c-card c-span"><Results runner={runner} variant="cards" /></div>
              </div>
            )}
          </>
        )}
      </main>
      {page === 'main' && (
        <footer className="c-foot">
          <button className="k-btn big" disabled={view === 0 || runner.running} onClick={() => setStep(view === runStep + 1 ? runStep - 1 : view - 1)}><ChevronLeft size={16} />{view === runStep + 1 ? '改设置再来一次' : '上一步'}</button>
          <span className="k-muted c-mid">{meta.name}<BrandMark /></span>
          {runner.running ? <button className="k-btn big" onClick={runner.pause}>暂停</button> : view > runStep ? <ExportAction runner={runner} /> : (
            <button className="k-btn primary big" disabled={batch && view === 0 && !runner.rows.length} onClick={next}>{view + 1 === runStep ? genLabel : '下一步'}<ChevronRight size={16} /></button>
          )}
        </footer>
      )}
    </div>
  );
}

function display(f: Runner['tool']['params'][number], v: string | number | boolean) {
  if (f.type === 'segment' || f.type === 'select') return f.options.find(([k]) => k === v)?.[1] ?? String(v);
  if (f.type === 'toggle') return v ? '开' : '关';
  if (f.type === 'number') return `${v}${f.unit ?? ''}`;
  if (f.type === 'folder') return String(v) || '下载 / 工具名';
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + '…' : s || '（未填）';
}

// ---------- D 暗色专业 · 预览为主 ----------
function LayoutD({ runner, meta, hover, page, setPage }: LayoutProps) {
  const [sel, setSel] = useState<string>();
  const row = runner.rows.find((r) => r.item.id === sel) ?? runner.rows.find((r) => r.status === 'run') ?? runner.rows[0];
  return (
    <div className="L-d">
      <div className="d-top"><b>{meta.name}</b><BrandMark /><span className="b-sp" />{pagesFor(runner).map(([p, l, I]) => <button key={p} className={`k-btn ghost${page === p ? ' on' : ''}`} onClick={() => setPage(p)}><I size={15} />{l || mainLabel(runner)}</button>)}</div>
      {page !== 'main' ? <div className="d-page k-scroll"><SubPage page={page} runner={runner} meta={meta} /></div> : runner.tool.mode === 'custom' ? <div className="d-page k-scroll"><CustomMain runner={runner} /></div> : (
        <div className="d-body">
          <aside className="d-files">
            <div className="d-files-hd"><Summary runner={runner} /><AddButtons runner={runner} compact /></div>
            <div className="k-scroll"><Results runner={runner} variant="compact" selected={row?.item.id} onSelect={setSel} /></div>
          </aside>
          <section className="d-stage">
            <Notice runner={runner} />
            <div className="d-view">{row ? <Preview row={row} runner={runner} /> : <EmptyState runner={runner} hover={hover} />}</div>
            <div className="d-ctl"><Footer runner={runner} /></div>
          </section>
          <aside className="d-side k-scroll"><ParamsPanel runner={runner} /><span className="b-sp" /><PrimaryAction runner={runner} /><ExportAction runner={runner} /></aside>
        </div>
      )}
    </div>
  );
}

// ---------- E 极简单窗 · 拖入即用 ----------
function LayoutE({ runner, meta, hover, page, setPage }: LayoutProps) {
  const [more, setMore] = useState(false);
  const all = visibleFields(runner);
  const quick: Field[] = all.length <= 5 ? all : all.slice(0, 4);
  const rest = all.filter((f) => !quick.includes(f));
  return (
    <div className="L-e">
      <div className="e-top"><BrandMark /><span className="b-sp" />{pagesFor(runner).slice(1).map(([p, l]) => <button key={p} className={`k-link${page === p ? ' on' : ''}`} onClick={() => setPage(page === p ? 'main' : p)}>{l}</button>)}</div>
      <main className="e-col k-scroll">
        {page !== 'main' ? <><button className="k-link" onClick={() => setPage('main')}><ChevronLeft size={14} />返回</button><SubPage page={page} runner={runner} meta={meta} /></> : (
          <>
            <h1 className="e-title">{meta.name}</h1>
            {runner.tool.mode === 'custom' ? <CustomMain runner={runner} /> : <>
            {runner.tool.Empty && !runner.rows.length && <EmptyState runner={runner} hover={hover} />}
            {runner.tool.mode === 'batch' ? <DropZone runner={runner} hover={hover} /> : !runner.tool.Empty && <p className="k-muted">{runner.tool.tagline}</p>}
            <div className="e-quick">
              {quick.map((f) => <FieldControl key={f.key} field={f} value={runner.params[f.key]} disabled={runner.running} onChange={(v) => runner.setParam(f.key, v)} />)}
            </div>
            {rest.length > 0 && <div><button className="k-chip" onClick={() => setMore(!more)}><Settings2 size={13} />{more ? '收起选项' : `更多选项（${rest.length}）`}</button></div>}
            {more && <div className="e-more">{rest.map((f) => <FieldControl key={f.key} field={f} value={runner.params[f.key]} disabled={runner.running} onChange={(v) => runner.setParam(f.key, v)} />)}</div>}
            <Notice runner={runner} />
            <Results runner={runner} variant={runner.tool.ResultBody ? 'rows' : 'compact'} />
            </>}
          </>
        )}
      </main>
      {page === 'main' && runner.tool.mode !== 'custom' && <footer className="e-foot"><Footer runner={runner}><ExportAction runner={runner} /><PrimaryAction runner={runner} /></Footer></footer>}
    </div>
  );
}

// ---------- F 顶部标签 · 卡片网格 ----------
function LayoutF({ runner, meta, hover, page, setPage }: LayoutProps) {
  const [filter, setFilter] = useState<'all' | 'ok' | 'err'>('all');
  const shown: Runner = filter === 'all' ? runner : { ...runner, rows: runner.rows.filter((r) => r.status === filter) };
  return (
    <div className="L-f">
      <div className="f-tabs" role="tablist"><span className="f-brand"><BrandMark /></span>
        {pagesFor(runner).map(([p, l, I]) => <button key={p} role="tab" aria-selected={page === p} className={`f-tab${page === p ? ' on' : ''}`} onClick={() => setPage(p)}><I size={15} />{l || mainLabel(runner)}</button>)}
        <span className="b-sp" />
        {page === 'main' && <AddButtons runner={runner} />}
      </div>
      {page !== 'main' ? <div className="f-page k-scroll"><SubPage page={page} runner={runner} meta={meta} /></div> : runner.tool.mode === 'custom' ? <div className="f-page k-scroll"><CustomMain runner={runner} /></div> : (
        <main className="f-body">
          <div className="f-bar">
            {([['all', `全部 ${runner.stats.total}`], ['ok', `已完成 ${runner.stats.ok}`], ['err', `失败 ${runner.stats.err}`]] as const).map(([k, l]) => <button key={k} className={`k-chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
            <span className="b-sp" />
            <details className="f-params"><summary className="k-btn"><Settings2 size={15} />参数</summary><div className="f-pop"><ParamsPanel runner={runner} /></div></details>
          </div>
          <Notice runner={runner} />
          <div className="k-scroll f-grid-wrap">{runner.rows.length ? <Results runner={shown} variant="cards" /> : <EmptyState runner={runner} hover={hover} />}</div>
        </main>
      )}
      {page === 'main' && runner.tool.mode !== 'custom' && <footer className="f-foot"><Footer runner={runner}><ExportAction runner={runner} /><PrimaryAction runner={runner} /></Footer></footer>}
    </div>
  );
}

export const LAYOUTS: Record<LayoutId, (p: LayoutProps) => ReactNode> = { a: LayoutA, b: LayoutB, c: LayoutC, d: LayoutD, e: LayoutE, f: LayoutF };
