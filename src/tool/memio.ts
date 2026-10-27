// 内存里的文件系统：单元测试和浏览器预览用，行为和 FileIO 一致。
import type { FileIO } from './io';

export function memoryIO(): FileIO & { files: Map<string, Uint8Array>; dirs: Set<string> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['/']);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const join = (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/');
  const parentsOf = (p: string) => {
    const segs = p.split('/').filter(Boolean);
    return segs.slice(0, -1).map((_, i) => '/' + segs.slice(0, i + 1).join('/'));
  };
  const norm = (p: string) => (p.startsWith('/') ? p : '/' + p);
  return {
    files, dirs, join,
    async readText(p) { const f = files.get(norm(p)); if (!f) throw new Error(`没有这个文件：${p}`); return dec.decode(f); },
    async writeText(p, t) { parentsOf(norm(p)).forEach((d) => dirs.add(d)); files.set(norm(p), enc.encode(t)); },
    async readBytes(p) { const f = files.get(norm(p)); if (!f) throw new Error(`没有这个文件：${p}`); return f; },
    async writeBytes(p, d) { parentsOf(norm(p)).forEach((x) => dirs.add(x)); files.set(norm(p), d); },
    async exists(p) { const n = norm(p); return files.has(n) || dirs.has(n); },
    async mkdir(p) { const n = norm(p); parentsOf(n).forEach((d) => dirs.add(d)); dirs.add(n); },
    async list(p) {
      const n = norm(p).replace(/\/$/, '') + '/';
      const names = new Set<string>();
      for (const k of [...files.keys(), ...dirs]) if (k.startsWith(n) && k !== n) names.add(k.slice(n.length).split('/')[0]);
      return [...names];
    },
    async remove(p, recursive) {
      const n = norm(p);
      for (const k of [...files.keys()]) if (k === n || (recursive && k.startsWith(n + '/'))) files.delete(k);
      for (const k of [...dirs]) if (k === n || (recursive && k.startsWith(n + '/'))) dirs.delete(k);
    },
  };
}
