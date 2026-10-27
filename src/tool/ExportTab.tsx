// 导出上架数据包：Excel / CSV 商品表 + 规格明细 + 图片文件夹。
import { useMemo, useState } from 'react';
import { Download, FolderOpen } from 'lucide-react';
import { pickFolder, reveal } from '../kit/platform';
import { errText, type AppCtx } from './app';
import { buildTables, PRODUCT_HEADERS, writePack } from './export';

export function ExportTab({ app }: { app: AppCtx }) {
  const { env, products, selected, settings } = app;
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [xlsx, setXlsx] = useState(true);
  const [csv, setCsv] = useState(false);
  const [images, setImages] = useState(true);
  const [done, setDone] = useState<{ dir: string; files: string[]; imageCount: number } | null>(null);
  const list = useMemo(() => (scope === 'all' ? products : products.filter((p) => selected.has(p.id))), [scope, products, selected]);
  const table = useMemo(() => buildTables(list, settings).products, [list, settings]);
  const show = [0, 1, 2, 4, 7, 5] as const; // 标题、类目、拼单价、库存、规格、主图
  const formats = [...(xlsx ? ['xlsx' as const] : []), ...(csv ? ['csv' as const] : [])];

  const doExport = async () => {
    if (!env) return;
    const dir = await pickFolder();
    if (!dir) return;
    app.setBusy('导出中…');
    try {
      const r = await writePack(list, settings, env.lib, env.io, dir, { formats, images });
      setDone(r);
      app.setNotice({ kind: 'ok', text: `已导出 ${list.length} 件商品：${r.files.join('、')}${images ? `，图片 ${r.imageCount} 张` : ''}`, path: r.dir });
    } catch (e) { app.setNotice({ kind: 'err', text: `导出失败：${errText(e)}` }); }
    app.setBusy('');
  };

  return (
    <div className="pp-cols">
      <aside className="k-panel pp-side k-scroll">
        <section className="pp-sec">
          <b>导出范围</b>
          <div className="k-seg" role="radiogroup" aria-label="导出范围">
            <button role="radio" aria-checked={scope === 'selected'} className={scope === 'selected' ? 'on' : ''} onClick={() => setScope('selected')}>勾选的（{selected.size}）</button>
            <button role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>全部（{products.length}）</button>
          </div>
        </section>
        <section className="pp-sec">
          <b>文件格式</b>
          <div className="k-multi">
            <label className={`k-chip${xlsx ? ' on' : ''}`}><input type="checkbox" hidden checked={xlsx} onChange={() => setXlsx(!xlsx)} />Excel 表格</label>
            <label className={`k-chip${csv ? ' on' : ''}`}><input type="checkbox" hidden checked={csv} onChange={() => setCsv(!csv)} />CSV（带 BOM）</label>
            <label className={`k-chip${images ? ' on' : ''}`}><input type="checkbox" hidden checked={images} onChange={() => setImages(!images)} />带图片文件夹</label>
          </div>
          <small className="k-muted">Excel 里有「商品」和「规格明细」两个工作表。图片按「商品编号 / main_01.jpg」存放，表里的主图列写的就是这个相对路径，多张用分号隔开。</small>
        </section>
        <button className="k-btn primary" disabled={!!app.busy || !list.length || !formats.length} onClick={doExport}><Download size={14} />导出到文件夹…</button>
        {done && <button className="k-btn ghost" onClick={() => reveal(done.dir)}><FolderOpen size={14} />在文件夹中显示</button>}
      </aside>
      <main className="pp-main k-scroll">
        <section className="k-panel pp-card">
          <h3>商品表预览（{list.length} 件）</h3>
          {list.length === 0 ? <p className="k-muted">没有可导出的商品。到「产品库」勾选商品，或选「全部」。</p> : (
            <div className="k-table-wrap">
              <table className="k-table">
                <thead><tr>{show.map((i) => <th key={i}>{PRODUCT_HEADERS[i]}</th>)}</tr></thead>
                <tbody>
                  {table.rows.slice(0, 8).map((r, k) => (
                    <tr key={k}>{show.map((i) => <td key={i} className="k-cell">{String(r[i])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="k-panel pp-card">
          <h3>全部列</h3>
          <p className="pp-cols-list">{PRODUCT_HEADERS.join('　·　')}</p>
          <p className="k-muted pp-p">最后一列「待处理」写着这件商品还缺什么（例如没有进价、没有主图）。价格 = 进价 × 设置里的系数，可在「规则与设置」里改。</p>
        </section>
      </main>
    </div>
  );
}
