// 反向检查：发布出去的源码、插件、文档、示例里，不应出现授权、收款、个人服务器、反检测、写死密钥这类内容。
// 这里只用通用模式匹配，不在测试里写出任何旧品牌名或个人域名。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', 'gen', 'kit', 'fixtures', '.git', 'binaries', 'icons', 'docs']);
const TEXT = /\.(ts|tsx|js|json|md|html|css|rs|toml|csv|yml|yaml)$/;

function collect(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(n)) collect(p, out); }
    else if (TEXT.test(n) && !/\.test\.ts$/.test(n) && n !== 'pnpm-lock.yaml' && n !== 'Cargo.lock' && n !== 'package-lock.json') out.push(p);
  }
  return out;
}
const files = ['src', 'extension', 'src-tauri', 'samples', '.github'].flatMap((d) => { try { return collect(join(root, d)); } catch { return []; } })
  .concat(['README.md', 'THIRD_PARTY_LICENSES.md', 'CHANGELOG.md', 'tool.json', 'package.json'].map((f) => join(root, f)));
const read = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => f.slice(root.length + 1).split('\\').join('/');

describe('发布内容检查', () => {
  it('扫到了足够多的文件（防止检查变成空转）', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => rel(f) === 'src-tauri/src/inject.js')).toBe(true);
    expect(files.some((f) => rel(f) === 'extension/manifest.json')).toBe(true);
  });
  it('没有 127.0.0.1 以外的 IP 地址', () => {
    for (const f of files) for (const ip of read(f).match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) {
      if (['127.0.0.1', '0.0.0.0'].includes(ip) || /^\d+\.\d+\.\d+\.\d+$/.test(ip) && /版本|version/i.test(rel(f))) continue;
      expect(ip, rel(f)).toMatch(/^(127\.0\.0\.1|0\.0\.0\.0)$/);
    }
  });
  it('出现的网址只限：本机、1688 / 淘宝 / 天猫 / 拼多多 / 阿里图片、篝火组织的仓库、标准文档地址', () => {
    const ok = /^https?:\/\/(\*$|127\.0\.0\.1|localhost|((\*|[\w-]+)\.)*(1688|alibaba|taobao|tmall|pinduoduo|alicdn|taobaocdn|tbcdn)\.(com|hk|cn)|github\.com\/campfire-code|schema\.tauri\.app|www\.w3\.org|tauri\.app|[\w-]+\.example(?![\w.])|doc\.rust-lang\.org|github\.com\/rust-lang)/;
    // 第三方许可证清单里本来就会列出各开源库的主页
    for (const f of files.filter((x) => !/THIRD_PARTY_LICENSES\.md$/.test(x))) for (const u of read(f).match(/https?:\/\/[^\s'"`)>\]\\，。）]+/g) ?? []) expect(u, rel(f)).toMatch(ok);
  });
  it('没有授权、激活、收款、分销、自动更新到私有服务器这类内容', () => {
    const bad = /激活码|授权服务|试用期|付费套餐|收款码|代理分销|device_?id|license[_ -]?(key|server|code)|activation|payment[-_ ]?qr|\/license\b|(?<!tauri-apps)\/api\//i;
    for (const f of files) expect(read(f).match(bad)?.[0] ?? null, rel(f)).toBeNull();
  });
  it('没有写死的密钥、AppSecret、本机路径、微信号、手机号', () => {
    const bad = /app[_-]?secret|appid\s*[:=]|sk-[A-Za-z0-9]{16,}|bearer\s+[A-Za-z0-9._-]{20,}|\/Users\/|[A-Z]:\\Users\\|微信号|(?<!\d)1[3-9]\d{9}(?!\d)/i;
    for (const f of files) expect(read(f).match(bad)?.[0] ?? null, rel(f)).toBeNull();
  });
  it('不含反检测与伪装：隐藏自动化标记、伪造人类轨迹、滑块自动处理、指纹伪装', () => {
    const bad = /navigator\.webdriver|webdriver|bezier|human[_-]?(type|click|move)|stealth|fingerprint|evaluateOnNewDocument|add_init_script|userAgent\s*=|\bslider\b|puppeteer|playwright|camoufox|--disable-blink-features/i;
    for (const f of files.filter((x) => /\.(js|ts|tsx|rs)$/.test(x))) expect(read(f).match(bad)?.[0] ?? null, rel(f)).toBeNull();
  });
  it('署名：不写参考仓库的名字、地址和目录', () => {
    const bad = /pdd-uploader|ref-src|collector-extension|1688Sourcing|AGENTS\.md|SOURCE_HANDOFF/;
    for (const f of files) expect(read(f).match(bad)?.[0] ?? null, rel(f)).toBeNull();
  });
  it('拼多多窗口的权限：只允许发事件，没有文件、网络、命令权限', () => {
    const remote = JSON.parse(read(join(root, 'src-tauri/capabilities/pdd-remote.json')));
    expect(remote.windows).toEqual(['pdd']);
    expect(remote.permissions).toEqual(['core:event:allow-emit']);
    expect(remote.remote.urls.every((u: string) => /^https:\/\/([\w*]+\.)?pinduoduo\.com\/\*$/.test(u))).toBe(true);
    const main = JSON.parse(read(join(root, 'src-tauri/capabilities/default.json')));
    expect(main.windows).toEqual(['main']);
  });
  it('主窗口的应用命令都在清单里声明，且拼多多窗口拿不到', () => {
    const lib = read(join(root, 'src-tauri/src/lib.rs'));
    const build = read(join(root, 'src-tauri/build.rs'));
    const main = read(join(root, 'src-tauri/capabilities/default.json'));
    for (const cmd of ['collector_status', 'prepare_extension', 'open_pdd', 'call_pdd', 'pdd_window_open', 'clear_pdd_login']) {
      expect(lib).toContain(`fn ${cmd}`);
      expect(build).toContain(`"${cmd}"`);
      expect(main).toContain(`allow-${cmd.replace(/_/g, '-')}`);
    }
  });
  it('采集接收服务：只监听本机，只认浏览器插件的来源', () => {
    const lib = read(join(root, 'src-tauri/src/lib.rs'));
    expect(lib).toContain('TcpListener::bind(("127.0.0.1", PORT))');
    expect(lib).not.toMatch(/0\.0\.0\.0/);
    expect(lib).toContain('chrome-extension://');
    expect(lib).toContain('x-campfire-collector');
  });
  it('插件随应用打包', () => {
    const conf = JSON.parse(read(join(root, 'src-tauri/tauri.conf.json')));
    expect(conf.bundle.resources).toEqual({ '../extension': 'extension' });
  });
});
