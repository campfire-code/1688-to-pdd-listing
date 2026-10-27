// 下载内置 ffmpeg：node scripts/fetch-ffmpeg.mjs [目标平台三元组，默认本机]
// 来源：eugeneware/ffmpeg-static 的发布 b6.1.1（ffmpeg 6.1.1 静态构建，GPL-3.0；Windows 版来自 gyan.dev）。
// 放到 src-tauri/binaries/ffmpeg-<三元组>[.exe]，并附上许可证文件随应用分发。
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const TAG = 'b6.1.1';
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${TAG}`;
const host = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'win32-x64': 'x86_64-pc-windows-msvc' }[`${process.platform}-${process.arch}`];
const triple = process.argv[2] ?? host;
const PLAT = { 'aarch64-apple-darwin': 'darwin-arm64', 'x86_64-apple-darwin': 'darwin-x64', 'x86_64-pc-windows-msvc': 'win32-x64' }[triple];
if (!PLAT) throw new Error(`不支持的平台：${triple}`);
const dir = new URL('../src-tauri/binaries/', import.meta.url);
mkdirSync(dir, { recursive: true });
const out = new URL(`ffmpeg-${triple}${triple.includes('windows') ? '.exe' : ''}`, dir);
if (existsSync(out)) { console.log('已存在', out.pathname); process.exit(0); }
const get = async (name) => {
  const r = await fetch(`${BASE}/${name}`);
  if (!r.ok) throw new Error(`下载失败 ${name}：HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};
writeFileSync(out, gunzipSync(await get(`ffmpeg-${PLAT}.gz`)));
chmodSync(out, 0o755);
writeFileSync(new URL('ffmpeg-LICENSE.txt', dir), gunzipSync(await get(`${PLAT}.LICENSE.gz`)));
console.log(`已下载 ffmpeg（${PLAT}）→ ${out.pathname}`);
