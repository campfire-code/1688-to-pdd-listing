// 批量任务调度：维护列表状态、并发执行、暂停、重试，所有布局共用。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InputItem, ItemResult, Params, RunContext, ToolDef } from './types';
import { chat } from './settings';
import { defaultOutputDir, ensureDir, ensureParent, expandPaths, fs, mediaDuration, runFfmpeg, runSidecar, settingsStore } from './platform';

export type Status = 'wait' | 'run' | 'ok' | 'err';
export interface Row {
  item: InputItem;
  status: Status;
  progress: number;
  result?: ItemResult;
  error?: string;
}
export interface HistoryEntry {
  at: string;
  total: number;
  ok: number;
  failed: number;
  outputDir: string;
}

const defaults = (tool: ToolDef): Params => Object.fromEntries(tool.params.map((f) => [f.key, f.default]));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useToolRunner(tool: ToolDef) {
  const [rows, setRows] = useState<Row[]>([]);
  const [params, setParamsState] = useState<Params>(() => defaults(tool));
  const [running, setRunning] = useState(false);
  const [outputDir, setOutputDir] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    (async () => {
      const st = await settingsStore();
      const saved = await st.get<Params>(`params.${tool.id}`);
      if (saved) setParamsState((p) => ({ ...p, ...saved }));
      setHistory((await st.get<HistoryEntry[]>(`history.${tool.id}`)) ?? []);
      setOutputDir(await defaultOutputDir(tool.name));
    })();
  }, [tool]);

  const folderKey = tool.params.find((f) => f.type === 'folder')?.key;
  const resolvedOut = (folderKey && (params[folderKey] as string)) || outputDir;

  const setParam = useCallback(
    (key: string, value: string | number | boolean) => {
      setParamsState((p) => {
        const next = { ...p, [key]: value };
        settingsStore().then((st) => st.set(`params.${tool.id}`, next));
        return next;
      });
    },
    [tool.id],
  );

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.item.id === id ? { ...r, ...p } : r)));

  const addPaths = useCallback(
    async (paths: string[]) => {
      if (tool.mode !== 'batch') return;
      const items = await expandPaths(paths, tool.accept.extensions);
      if (!items.length) {
        setNotice({ kind: 'err', text: `没有找到可处理的文件，支持：${tool.accept.extensions.join('、')}` });
        return;
      }
      const known = new Set(rowsRef.current.map((r) => r.item.path));
      const fresh = items.filter((i) => !known.has(i.path));
      setRows((rs) => [
        ...rs,
        ...fresh.map((item): Row => {
          const bad = tool.check?.(item);
          return bad ? { item, status: 'err', progress: 0, error: bad } : { item, status: 'wait', progress: 0 };
        }),
      ]);
    },
    [tool],
  );

  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.item.id !== id));
  const clear = () => !running && setRows([]);

  const makeCtx = (signal: AbortSignal, onProgress: (r: number) => void): RunContext => ({
    params,
    outputDir: resolvedOut,
    signal,
    progress: onProgress,
    readFile: fs.readFile,
    readText: fs.readTextFile,
    writeFile: async (p, d) => { await ensureParent(p); await fs.writeFile(p, d); },
    writeText: async (p, t) => { await ensureParent(p); await fs.writeTextFile(p, t); },
    mkdir: ensureDir,
    join: (...parts) => fs.join(...parts),
    llm: (m, o) => chat(m, { ...o, signal }),
    sidecar: runSidecar,
    ffmpeg: (args, onTime) => runFfmpeg(args, onTime, signal),
    duration: mediaDuration,
  });

  const start = useCallback(async () => {
    if (running) return;
    let queue: Row[];
    if (tool.mode === 'generate') {
      // 有「重试失败的」留下的等待条目时只重跑这些，否则整批重新生成
      const retry = rowsRef.current.filter((r) => r.status === 'wait');
      if (retry.length && retry.length < rowsRef.current.length) {
        queue = retry;
      } else {
        const n = tool.count?.(params) ?? 1;
        const items: Row[] = Array.from({ length: n }, (_, i) => ({ item: { id: `g${Date.now()}_${i}`, name: tool.itemName?.(i, params) ?? `第 ${i + 1} 条` }, status: 'wait', progress: 0 }));
        setRows(items);
        queue = items;
      }
    } else {
      if (tool.mode !== 'batch') return;
      queue = rowsRef.current.filter((r) => r.status === 'wait');
    }
    if (!queue.length) {
      setNotice({ kind: 'err', text: tool.mode === 'batch' ? `先添加${tool.accept.label}` : '没有要生成的内容' });
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setNotice(null);
    await ensureDir(resolvedOut).catch(() => {});
    let ok = 0;
    let failed = 0;
    const worker = async () => {
      for (;;) {
        if (ac.signal.aborted) return;
        const row = queue.shift();
        if (!row) return;
        const id = row.item.id;
        patch(id, { status: 'run', progress: 0, error: undefined });
        try {
          const ctx = makeCtx(ac.signal, (p) => patch(id, { progress: Math.max(0, Math.min(1, p)) }));
          const index = tool.mode === 'generate' ? Number(id.split('_').pop()) : 0;
          const result = tool.mode === 'generate' ? await tool.generate(index, ctx) : await tool.run(row.item, ctx);
          if (ac.signal.aborted) return patch(id, { status: 'wait', progress: 0 });
          patch(id, { status: 'ok', progress: 1, result });
          ok++;
        } catch (e) {
          if (ac.signal.aborted) return patch(id, { status: 'wait', progress: 0 });
          patch(id, { status: 'err', error: errText(e) });
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: tool.concurrency ?? 2 }, worker));
    await new Promise((r) => setTimeout(r, 0));
    setRunning(false);
    abortRef.current = null;
    let tail = '';
    if (!ac.signal.aborted && 'afterAll' in tool && tool.afterAll && ok) {
      const done = rowsRef.current.filter((r) => r.status === 'ok' && r.result).map((r) => ({ item: r.item, result: r.result! }));
      setNotice({ kind: 'ok', text: '正在汇总结果…' });
      try {
        tail = (await tool.afterAll(done, makeCtx(ac.signal, (r) => setNotice({ kind: 'ok', text: `正在汇总结果… ${Math.round(r * 100)}%` })))) || '';
      } catch (e) {
        tail = `收尾失败：${errText(e)}`;
        failed++;
      }
    }
    if (!ac.signal.aborted) {
      if (tail) tail = '。' + tail;
      setNotice(failed ? { kind: 'err', text: `完成 ${ok} 个，失败 ${failed} 个，失败原因见列表${tail}` } : { kind: 'ok', text: `全部完成，共 ${ok} 个${tail}` });
      const entry: HistoryEntry = { at: new Date().toISOString(), total: ok + failed, ok, failed, outputDir: resolvedOut };
      setHistory((h) => {
        const next = [entry, ...h].slice(0, 50);
        settingsStore().then((st) => st.set(`history.${tool.id}`, next));
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, tool, params, resolvedOut]);

  const pause = () => {
    abortRef.current?.abort();
    setRunning(false);
    setRows((rs) => rs.map((r) => (r.status === 'run' ? { ...r, status: 'wait', progress: 0 } : r)));
  };

  const retryFailed = () => setRows((rs) => rs.map((r) => (r.status === 'err' ? { ...r, status: 'wait', error: undefined, progress: 0 } : r)));

  const exportAll = async () => {
    if (!tool.exportAll) return;
    const done = rowsRef.current.filter((r) => r.status === 'ok' && r.result).map((r) => ({ item: r.item, result: r.result! }));
    if (!done.length) return setNotice({ kind: 'err', text: '还没有处理完成的结果' });
    try {
      await ensureDir(resolvedOut);
      const path = await tool.exportAll(done, makeCtx(new AbortController().signal, () => {}));
      setNotice({ kind: 'ok', text: `已导出：${path}` });
    } catch (e) {
      setNotice({ kind: 'err', text: `导出失败：${errText(e)}` });
    }
  };

  const stats = useMemo(() => {
    const s = { total: rows.length, ok: 0, err: 0, wait: 0, run: 0 };
    for (const r of rows) s[r.status]++;
    const done = rows.reduce((a, r) => a + (r.status === 'ok' || r.status === 'err' ? 1 : r.status === 'run' ? r.progress : 0), 0);
    return { ...s, ratio: rows.length ? done / rows.length : 0 };
  }, [rows]);

  const ctx = useMemo(() => makeCtx(new AbortController().signal, () => {}), [params, resolvedOut]); // eslint-disable-line react-hooks/exhaustive-deps

  return { tool, ctx, rows, params, setParam, running, start, pause, retryFailed, addPaths, remove, clear, exportAll, stats, outputDir: resolvedOut, history, notice, setNotice };
}

export type Runner = ReturnType<typeof useToolRunner>;
