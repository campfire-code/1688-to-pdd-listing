import { Component, useEffect, useState, type ReactNode } from 'react';
import type { ToolDef, ToolMeta } from './types';
import { useToolRunner } from './runner';
import { LAYOUTS, type Page } from './layouts';
import { emitDrop, emitHover, onFileDrop } from './platform';
import { useSettings } from './settings';
import './kit.css';

/** 工具自己的主色：亮色直接用，暗色调亮一些；浅底色由主色混出来。没有时用 palette 的主色 */
export function applyAccent(el: HTMLElement, a: string | undefined, mode: string) {
  if (a) {
    el.style.setProperty('--primary', mode === 'dark' ? `color-mix(in srgb, ${a} 70%, white)` : a);
    el.style.setProperty('--primary-soft', mode === 'dark' ? `color-mix(in srgb, ${a} 22%, #111)` : `color-mix(in srgb, ${a} 12%, white)`);
  } else {
    el.style.removeProperty('--primary');
    el.style.removeProperty('--primary-soft');
  }
}

/** 按抽签结果挂布局、配色、亮暗 */
export function KitApp({ tool, meta, size = 'std' }: { tool: ToolDef; meta: ToolMeta; size?: 'std' | 'large' }) {
  const runner = useToolRunner(tool);
  const { theme } = useSettings();
  const [page, setPage] = useState<Page>('main');
  const [hover, setHover] = useState(false);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const mode = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.layout = meta.ui.layout;
    el.dataset.palette = meta.ui.palette;
    el.dataset.mode = mode;
    el.dataset.size = size;
    applyAccent(el, meta.ui.accent, mode);
    el.lang = 'zh-CN';
    document.title = meta.name;
  }, [meta, mode, size]);

  const { addPaths, running } = runner;
  useEffect(() => {
    let off: (() => void) | undefined;
    const custom = tool.mode === 'custom';
    onFileDrop((paths) => {
      if (running) return;
      setPage('main');
      if (custom) emitDrop(paths);
      else addPaths(paths);
    }, (on) => (custom ? emitHover(on) : setHover(on))).then((u) => (off = u));
    return () => off?.();
  }, [addPaths, running, tool.mode]);

  const Layout = LAYOUTS[meta.ui.layout];
  return <Layout runner={runner} meta={meta} hover={hover} page={page} setPage={setPage} />;
}

/** 界面出错时显示原因，而不是白屏 */
export class KitErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="k-page" style={{ padding: 24 }}>
        <h3>界面出错了</h3>
        <p className="k-muted">请把下面这段文字截图发给维护者，或到源码仓库提交问题。</p>
        <pre className="k-result-text">{String(this.state.error.stack || this.state.error.message)}</pre>
        <button className="k-btn" onClick={() => location.reload()}>重新加载</button>
      </div>
    );
  }
}
