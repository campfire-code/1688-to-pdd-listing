// 测试用的小工具：生成真实的 PNG 图片字节、假的网络。
import { deflateSync } from 'node:zlib';
import type { Fetcher } from './io';

function crc32(buf: Uint8Array): number {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 生成 size×size 的 PNG：纯色底加一个色块，再叠一点确定性的噪点（让文件大于几 KB，更像真实图片） */
export function makePng(seed: number, size = 64): Uint8Array {
  const hue = (seed * 47) % 360;
  const [r, g, b] = hsl(hue, 0.4, 0.8);
  const [r2, g2, b2] = hsl(hue, 0.5, 0.42);
  let s = seed * 2654435761 >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const raw = new Uint8Array((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inside = x > size * 0.3 && x < size * 0.7 && y > size * 0.2 && y < size * 0.85;
      const base = inside ? [r2, g2, b2] : [r, g, b];
      const n = Math.floor((rnd() - 0.5) * 40);
      for (let k = 0; k < 3; k++) raw[y * (size * 3 + 1) + 1 + x * 3 + k] = Math.max(0, Math.min(255, base[k] + n));
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size); dv.setUint32(4, size); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
export const pngDataUrl = (seed: number) => `data:image/png;base64,${Buffer.from(makePng(seed)).toString('base64')}`;

/** 假的网络：按地址返回预设字节；没预设的返回 404，并记录每次请求的头 */
export function fakeFetcher(files: Record<string, Uint8Array | number>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const f = files[url];
    if (f === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    if (typeof f === 'number') return { ok: false, status: f, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer };
  };
  return { fetcher, calls };
}
