// 采集插件：一键打开插件文件夹，给出「加载已解压的扩展程序」的步骤，检查本机接收服务是否在运行。
import { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, PlugZap, RefreshCw, TriangleAlert } from 'lucide-react';
import { httpFetch, openFolder } from '../kit/platform';
import { errText, type AppCtx } from './app';
import { inTauri } from './env';

export function PluginTab({ app, drain }: { app: AppCtx; drain: () => Promise<void> }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [dir, setDir] = useState('');

  const check = async () => {
    if (!inTauri) return setState({ ok: true, text: '预览模式：未启动本机接收服务' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const url = await invoke<string>('collector_status');
      const r = await httpFetch(`${url}/health`);
      setState(r.ok ? { ok: true, text: `接收服务运行中（${url}）` } : { ok: false, text: `接收服务返回了 ${r.status}` });
    } catch (e) { setState({ ok: false, text: errText(e) }); }
  };
  useEffect(() => { void check(); }, []);

  const openExt = async () => {
    if (!inTauri) return app.setNotice({ kind: 'err', text: '预览模式下没有插件文件夹' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const d = await invoke<string>('prepare_extension');
      setDir(d);
      await openFolder(d);
    } catch (e) { app.setNotice({ kind: 'err', text: errText(e) }); }
  };

  return (
    <div className="pp-cols">
      <aside className="k-panel pp-side k-scroll">
        <section className="pp-sec">
          <b>本机接收服务</b>
          <div className={`pp-state ${state ? (state.ok ? 'ok' : 'err') : ''}`}>
            {state ? (state.ok ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />) : null}
            <span>{state ? state.text : '检查中…'}</span>
          </div>
          <div className="pp-btns">
            <button className="k-btn" onClick={check}><PlugZap size={14} />重新检查</button>
            <button className="k-btn" onClick={() => void drain()}><RefreshCw size={14} />处理收件箱</button>
          </div>
          <small className="k-muted">插件把商品发到本机 127.0.0.1 的 48765 端口，不经过任何服务器。端口被占用时（例如开了两个本应用的窗口）这里会提示。</small>
        </section>
        <section className="pp-sec">
          <b>数据怎么从插件到应用</b>
          <p className="k-muted pp-p">你在商品页点「采集当前商品」→ 插件把商品 JSON 发给本机接收服务 → 服务先把它存成收件箱里的一个文件 → 应用把它入库并下载图片。应用没开时，插件会暂存在浏览器里，应用打开后点插件里的「重新发送暂存」。</p>
        </section>
      </aside>
      <main className="pp-main k-scroll">
        <section className="k-panel pp-card">
          <h3>安装采集插件（Chrome / Edge，一次性）</h3>
          <ol className="pp-steps">
            <li>
              <b>打开插件文件夹</b>
              <p className="k-muted">点下面的按钮，应用会把插件复制到固定位置并打开它所在的文件夹。</p>
              <button className="k-btn primary" onClick={openExt}><FolderOpen size={14} />打开插件文件夹</button>
              {dir && <p className="pp-path">{dir}</p>}
            </li>
            <li><b>打开浏览器的扩展程序页</b><p className="k-muted">在地址栏输入 <code>chrome://extensions</code>（Edge 输入 <code>edge://extensions</code>）并回车。</p></li>
            <li><b>打开「开发者模式」</b><p className="k-muted">页面右上角（Edge 在左下角）有一个开关，打开它。</p></li>
            <li><b>点「加载已解压的扩展程序」</b><p className="k-muted">选择第 1 步打开的那个文件夹（里面直接能看到 manifest.json）。出现「篝火采集」就装好了，可以点浏览器右上角的拼图图标把它固定出来。</p></li>
            <li><b>去 1688 / 淘宝 / 天猫商品页采集</b><p className="k-muted">先在浏览器里登录，打开任意商品详情页，点插件图标 →「采集当前商品」。本应用保持开着，商品会自动出现在「产品库」。登录、验证码都由你自己在页面里处理，插件不会替你过验证。</p></li>
          </ol>
          <small className="k-muted">首次加载时浏览器可能提示「停用开发者模式的扩展程序」，选择保留即可。本应用更新后，在扩展程序页点插件上的刷新按钮即可用上新版。</small>
        </section>
        <section className="k-panel pp-card">
          <h3>备用：手动导入</h3>
          <p className="k-muted pp-p">如果插件连不上应用，可以在「产品库」点「导入采集文件」，选择插件采集的 JSON 文件（一件商品一个文件，或多件合在一个数组里）。</p>
        </section>
      </main>
    </div>
  );
}
