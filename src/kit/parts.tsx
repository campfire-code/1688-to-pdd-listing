// 各布局共用的小部件：状态标签、进度条、缩略图、参数表单、拖放区、设置 / 记录 / 关于页。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X, Loader2, FileText, FolderOpen, Copy, Plus, FolderPlus, Upload, ExternalLink } from 'lucide-react';
import type { Field, ToolMeta } from './types';
import { BRAND } from './brand';
import type { Row, Runner } from './runner';
import { addDropListener, fileSrc, openFolder, openLink, pickFiles, pickFolder, reveal } from './platform';
import { LLM_PRESETS, chat, llmReady, saveSettings, useSettings, type ThemePref } from './settings';

export const pct = (r: number) => `${Math.round(r * 100)}%`;

export function StatusChip({ row, short }: { row: Row; short?: boolean }) {
  if (row.status === 'ok') return <span className="k-st ok" title={row.result?.summary}><Check size={12} />{short ? '完成' : row.result?.summary || '已完成'}</span>;
  if (row.status === 'err') return <span className="k-st err" title={row.error}><X size={12} />{short ? '失败' : `失败：${row.error}`}</span>;
  if (row.status === 'run') return <span className="k-st run"><Loader2 size={12} className="k-spin" />处理中 {pct(row.progress)}</span>;
  return <span className="k-st wait">等待中</span>;
}

export const ProgressBar = ({ ratio, label }: { ratio: number; label?: string }) => (
  <span className="k-bar" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? '总进度'}>
    <i style={{ width: pct(ratio) }} />
  </span>
);

export function Thumb({ row, runner, done }: { row: Row; runner: Runner; done?: boolean }) {
  const src = done !== false && row.result?.preview ? row.result.preview : runner.tool.type === 'media' ? row.item.path : undefined;
  if (src && /\.(png|jpe?g|webp|gif|bmp)$|^data:image/i.test(src)) return <img className="k-thumb" src={fileSrc(src)} alt="" loading="lazy" />;
  return <span className="k-thumb k-thumb-file"><FileText size={16} /></span>;
}

export function RowActions({ row }: { row: Row }) {
  const r = row.result;
  if (row.status !== 'ok' || !r) return null;
  return (
    <span className="k-row-actions">
      {r.outputPath && <button className="k-icon-btn" aria-label="在文件夹中显示" title="在文件夹中显示" onClick={() => reveal(r.outputPath!)}><FolderOpen size={15} /></button>}
      {(r.copyText ?? r.text) && <CopyButton text={(r.copyText ?? r.text)!} />}
    </span>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className={label ? 'k-btn' : 'k-icon-btn'} aria-label="复制" title="复制" onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? <Check size={15} /> : <Copy size={15} />}{label && (ok ? '已复制' : label)}
    </button>
  );
}

export function FieldControl({ field, value, onChange, disabled }: { field: Field; value: string | number | boolean; onChange: (v: string | number | boolean) => void; disabled?: boolean }) {
  const id = `f-${field.key}`;
  let control: ReactNode;
  switch (field.type) {
    case 'segment':
      control = (
        <div className="k-seg" role="radiogroup" aria-label={field.label}>
          {field.options.map(([v, l]) => (
            <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} disabled={disabled} onClick={() => onChange(v)}>{l}</button>
          ))}
        </div>
      );
      break;
    case 'select':
      control = (
        <select id={id} className="k-input" value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {field.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      );
      break;
    case 'number':
      control = (
        <span className="k-input-wrap">
          <input id={id} className="k-input" type="number" value={Number(value)} min={field.min} max={field.max} step={field.step ?? 1} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
          {field.unit && <span className="k-unit">{field.unit}</span>}
        </span>
      );
      break;
    case 'text':
      control = <input id={id} className="k-input" value={String(value)} placeholder={field.placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'textarea':
      control = <textarea id={id} className="k-input k-textarea" rows={field.rows ?? 4} value={String(value)} placeholder={field.placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'toggle':
      control = (
        <label className="k-toggle"><input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span>{value ? '开' : '关'}</span></label>
      );
      break;
    case 'multi': {
      const set = new Set(String(value).split(',').filter(Boolean));
      control = (
        <div className="k-multi" role="group" aria-label={field.label}>
          {field.options.map(([v, l]) => (
            <label key={v} className={`k-chip${set.has(v) ? ' on' : ''}`}>
              <input type="checkbox" checked={set.has(v)} disabled={disabled} onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(v); else next.delete(v);
                onChange(field.options.map(([k]) => k).filter((k) => next.has(k)).join(','));
              }} />{l}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'file':
      control = (
        <button id={id} className="k-input k-folder" disabled={disabled} onClick={async () => { const [p] = await pickFiles(field.extensions, field.fileLabel); if (p) onChange(p); }}>
          <span>{String(value) ? String(value).split(/[\\/]/).pop() : `选择${field.fileLabel}`}</span><FileText size={14} />
        </button>
      );
      break;
    case 'folder':
      control = (
        <button id={id} className="k-input k-folder" disabled={disabled} onClick={async () => { const p = await pickFolder(); if (p) onChange(p); }}>
          <span>{String(value) || '默认：下载 / 工具名'}</span><FolderOpen size={14} />
        </button>
      );
      break;
  }
  return (
    <div className="k-field">
      <label className="k-label" htmlFor={id}>{field.label}</label>
      {control}
      {field.help && <span className="k-help">{field.help}</span>}
    </div>
  );
}

export function ParamsPanel({ runner, title }: { runner: Runner; title?: string }) {
  return (
    <div className="k-params">
      {title && <b className="k-params-title">{title}</b>}
      {visibleFields(runner).map((f) => (
        <FieldControl key={f.key} field={f} value={runner.params[f.key]} disabled={runner.running} onChange={(v) => runner.setParam(f.key, v)} />
      ))}
    </div>
  );
}

export function AddButtons({ runner, compact }: { runner: Runner; compact?: boolean }) {
  if (runner.tool.mode !== 'batch') return null;
  const t = runner.tool;
  return (
    <>
      <button className="k-btn" disabled={runner.running} onClick={async () => runner.addPaths(await pickFiles(t.accept.extensions, t.accept.label))}><Plus size={15} />{compact ? '添加' : `添加${/^[A-Za-z]/.test(t.accept.label) ? ' ' : ''}${t.accept.label}`}</button>
      <button className="k-btn" disabled={runner.running} onClick={async () => { const p = await pickFolder(); if (p) runner.addPaths([p]); }}><FolderPlus size={15} />{compact ? '文件夹' : '添加文件夹'}</button>
    </>
  );
}

export function DropZone({ runner, hover, big }: { runner: Runner; hover: boolean; big?: boolean }) {
  if (runner.tool.mode !== 'batch') return null;
  const t = runner.tool;
  return (
    <button className={`k-drop${hover ? ' hover' : ''}${big ? ' big' : ''}`} disabled={runner.running} onClick={async () => runner.addPaths(await pickFiles(t.accept.extensions, t.accept.label))}>
      <Upload size={big ? 26 : 20} />
      <span><b>把{t.accept.label}拖到这里</b>，或点击选择<br /><small>支持 {t.accept.extensions.map((e) => e.toUpperCase()).join(' / ')}，可以拖入整个文件夹</small></span>
    </button>
  );
}

export function Notice({ runner }: { runner: Runner }) {
  const n = runner.notice;
  if (!n) return null;
  return (
    <div className={`k-notice ${n.kind}`} role={n.kind === 'err' ? 'alert' : 'status'}>
      <span>{n.text}</span>
      {n.kind === 'ok' && <button className="k-link" onClick={() => openFolder(runner.outputDir)}>打开输出文件夹</button>}
      {runner.stats.err > 0 && !runner.running && <button className="k-link" onClick={runner.retryFailed}>重试失败的</button>}
      <button className="k-icon-btn" aria-label="关闭提示" onClick={() => runner.setNotice(null)}><X size={14} /></button>
    </div>
  );
}

export function PrimaryAction({ runner, big }: { runner: Runner; big?: boolean }) {
  const t = runner.tool;
  const label = t.mode === 'generate' ? t.generateLabel ?? '开始生成' : '开始处理';
  return runner.running ? (
    <button className={`k-btn${big ? ' big' : ''}`} onClick={runner.pause}>暂停</button>
  ) : (
    <button className={`k-btn primary${big ? ' big' : ''}`} disabled={t.mode === 'batch' && runner.stats.wait === 0} title={t.mode === 'batch' && runner.stats.total > 0 && runner.stats.wait === 0 ? '没有待处理的文件，添加新文件或重试失败的' : undefined} onClick={runner.start}>{label}</button>
  );
}

export function ExportAction({ runner }: { runner: Runner }) {
  if (runner.tool.exportAll) return <button className="k-btn" disabled={!runner.stats.ok || runner.running} onClick={runner.exportAll}>{runner.tool.exportLabel ?? '导出全部结果'}</button>;
  return <button className="k-btn" disabled={!runner.stats.ok} onClick={() => openFolder(runner.outputDir)}><FolderOpen size={15} />打开输出文件夹</button>;
}

export function Summary({ runner }: { runner: Runner }) {
  const s = runner.stats;
  if (!s.total) return <span className="k-muted">{runner.tool.mode === 'batch' ? `还没有添加${/^[A-Za-z]/.test(runner.tool.accept.label) ? ' ' : ''}${runner.tool.accept.label}` : '设置好参数后点「开始生成」'}</span>;
  return <span className="k-muted k-num">共 {s.total} · 完成 {s.ok}{s.err ? ` · 失败 ${s.err}` : ''}{s.wait ? ` · 等待 ${s.wait}` : ''}</span>;
}

export function EmptyState({ runner, hover }: { runner: Runner; hover: boolean }) {
  const Custom = runner.tool.mode !== 'custom' ? runner.tool.Empty : undefined;
  if (Custom) return <div className={`k-empty-custom${hover ? ' hover' : ''}`}><Custom hover={hover} /></div>;
  return runner.tool.mode === 'batch' ? <DropZone runner={runner} hover={hover} big /> : (
    <div className="k-empty"><b>{runner.tool.name}</b><span>{runner.tool.tagline}</span>{runner.tool.mode === 'generate' && <span className="k-muted">在参数里填好内容，点「{runner.tool.generateLabel ?? '开始生成'}」</span>}</div>
  );
}

export function ResultText({ row }: { row: Row }) {
  if (row.status !== 'ok' || !row.result?.text) return null;
  return <div className="k-result-text"><pre>{row.result.text}</pre><CopyButton text={row.result.copyText ?? row.result.text} label="复制" /></div>;
}

// ---------- 设置 / 记录 / 关于 ----------

function ThemeSwitch() {
  const s = useSettings();
  return (
    <section className="k-section">
      <h3>外观</h3>
      <div className="k-seg" role="radiogroup" aria-label="外观">
        {([['system', '跟随系统'], ['light', '亮色'], ['dark', '暗色']] as [ThemePref, string][]).map(([v, l]) => (
          <button key={v} role="radio" aria-checked={s.theme === v} className={s.theme === v ? 'on' : ''} onClick={() => saveSettings({ theme: v })}>{l}</button>
        ))}
      </div>
    </section>
  );
}

/** 只有需要大模型的工具才有这个页面 */
export function SettingsPage() {
  const s = useSettings();
  const [draft, setDraft] = useState(s.llm);
  const [test, setTest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(s.llm), [s.llm]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.llm);
  return (
    <div className="k-page">
      <section className="k-section">
        <h3>大模型</h3>
        <p className="k-muted">本工具需要调用大模型。填你自己的接口密钥，兼容 OpenAI 接口格式；密钥只保存在这台电脑上。</p>
        <div className="k-presets">
          {LLM_PRESETS.map((p) => (
            <button key={p.name} className="k-chip" onClick={() => setDraft({ ...draft, baseUrl: p.baseUrl || draft.baseUrl, model: p.model || draft.model })}>{p.name}</button>
          ))}
        </div>
        <div className="k-field"><label className="k-label" htmlFor="llm-url">接口地址</label><input id="llm-url" className="k-input" value={draft.baseUrl} placeholder="https://api.deepseek.com/v1" onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value.trim() })} /></div>
        <div className="k-field"><label className="k-label" htmlFor="llm-key">密钥</label><input id="llm-key" className="k-input" type="password" autoComplete="off" value={draft.apiKey} placeholder="sk-..." onChange={(e) => setDraft({ ...draft, apiKey: e.target.value.trim() })} /></div>
        <div className="k-field"><label className="k-label" htmlFor="llm-model">模型名</label><input id="llm-model" className="k-input" value={draft.model} placeholder="deepseek-chat" onChange={(e) => setDraft({ ...draft, model: e.target.value.trim() })} /></div>
        <div className="k-actions">
          <button className="k-btn primary" disabled={!dirty} onClick={async () => { await saveSettings({ llm: draft }); setTest('已保存'); }}>保存</button>
          <button className="k-btn" disabled={busy || !llmReady(draft)} onClick={async () => {
            setBusy(true); setTest(null);
            try { await saveSettings({ llm: draft }); const r = await chat([{ role: 'user', content: '只回复两个字：可以' }], { temperature: 0 }); setTest(`连接成功，模型回复：${r.slice(0, 20)}`); }
            catch (e) { setTest(e instanceof Error ? e.message : String(e)); }
            setBusy(false);
          }}>{busy ? '测试中…' : '保存并测试连接'}</button>
          {test && <span className="k-muted" role="status">{test}</span>}
        </div>
      </section>
      <ThemeSwitch />
    </div>
  );
}

export function HistoryPage({ runner }: { runner: Runner }) {
  if (!runner.history.length) return <div className="k-page"><p className="k-muted">还没有处理记录。每次批量处理完成后会记在这里。</p></div>;
  return (
    <div className="k-page">
      <table className="k-table">
        <thead><tr><th>时间</th><th>数量</th><th>成功</th><th>失败</th><th>输出位置</th></tr></thead>
        <tbody>
          {runner.history.map((h) => (
            <tr key={h.at}><td className="k-num">{new Date(h.at).toLocaleString('zh-CN')}</td><td className="k-num">{h.total}</td><td className="k-num">{h.ok}</td><td className="k-num">{h.failed}</td><td><button className="k-link" onClick={() => openFolder(h.outputDir)}>{h.outputDir}</button></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AboutPage({ meta, tagline, withTheme }: { meta: ToolMeta; tagline: string; withTheme?: boolean }) {
  return (
    <div className="k-page">
      <section className="k-section">
        <h3>{meta.name}</h3>
        <p>{tagline}</p>
        <p className="k-muted k-num">版本 {meta.version} · {meta.license} 开源</p>
        {meta.upstream && <p className="k-muted">基于开源项目 {meta.upstream.repo}（{meta.upstream.license}）</p>}
        <div className="k-actions">
          <button className="k-btn" onClick={() => openLink(`https://github.com/${meta.repo}`)}><ExternalLink size={15} />源码</button>
          <button className="k-btn" onClick={() => openLink(`https://github.com/${meta.repo}/releases/latest`)}><ExternalLink size={15} />检查新版本</button>
        </div>
      </section>
      <section className="k-section">
        <h3>归属</h3>
        <p><span className="k-brand">{BRAND.mark}</span></p>
        <p className="k-muted">{BRAND.statement}</p>
        <p className="k-muted">更多工具：{BRAND.store}</p>
        <div className="k-actions"><button className="k-btn" onClick={() => openLink(`https://github.com/${BRAND.org}/toolkit-hub`)}><ExternalLink size={15} />全部开源工具</button></div>
      </section>
      {withTheme && <ThemeSwitch />}
    </div>
  );
}

/** 界面里的归属标识，各布局放在不抢眼的位置 */
export const BrandMark = () => <span className="k-brand" title={BRAND.statement}>{BRAND.mark}</span>;

/** 按 when 条件过滤当前要显示的参数 */
export const visibleFields = (runner: Runner) => runner.tool.params.filter((f) => !f.when || f.when(runner.params));

/** 自定义型工具里接收拖进窗口的文件：返回是否正在拖动经过窗口 */
export function useDroppedFiles(onFiles: (paths: string[]) => void) {
  const [hover, setHover] = useState(false);
  const ref = useRef(onFiles);
  ref.current = onFiles;
  useEffect(() => addDropListener({ onFiles: (p) => ref.current(p), onHover: setHover }), []);
  return hover;
}
