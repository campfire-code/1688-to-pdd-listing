// 图片批量下载：主图和详情图落到产品文件夹里。支持 http(s) 地址和 data: 地址。
import type { FileIO, Fetcher } from './io';

/** 小于这个大小的当成占位图、统计像素丢掉（参考实现用 8 KB，这里放宽到 2 KB 以免误删小图标式主图） */
export const MIN_IMAGE_BYTES = 2048;

export function refererFor(url: string, platform: string): string {
  if (platform === 'taobao' || platform === 'tmall') return 'https://item.taobao.com/';
  void url;
  return 'https://detail.1688.com/';
}

/** 看文件开头几个字节判断格式，判断不了再看地址后缀，最后默认 jpg */
export function sniffExt(bytes: Uint8Array, url: string): 'jpg' | 'png' | 'webp' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57) return 'webp';
  const m = /\.(jpe?g|png|webp)(?:[?_]|$)/i.exec(url);
  if (m) return m[1].toLowerCase().startsWith('jp') ? 'jpg' : (m[1].toLowerCase() as 'png' | 'webp');
  return 'jpg';
}

export function decodeDataUrl(url: string): Uint8Array | null {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(url);
  if (!m) return null;
  const bin = atob(m[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getBytes(url: string, fetcher: Fetcher, referer: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  if (url.startsWith('data:')) return decodeDataUrl(url);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetcher(url, { headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' }, signal });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      if (res.status === 403 || res.status === 404) return null;
    } catch {
      if (signal?.aborted) throw new Error('已取消');
    }
  }
  return null;
}

export interface DownloadResult {
  /** 成功保存的文件，相对 dir 的上一级（即产品文件夹），如 main/main_01.jpg */
  saved: string[];
  failed: string[];
}

/**
 * 把一组图片下载到 productDir/sub/ 下，文件名 prefix_01.jpg 起。
 * 并发 4 张；个别失败不影响其它；返回保存下来的文件和失败的地址。
 */
export async function downloadImages(
  urls: string[], productDir: string, sub: 'main' | 'detail', prefix: string,
  deps: { io: FileIO; fetcher: Fetcher; platform: string; signal?: AbortSignal; onEach?: (done: number, total: number) => void },
): Promise<DownloadResult> {
  const dir = deps.io.join(productDir, sub);
  await deps.io.mkdir(dir);
  const results: (string | null)[] = urls.map(() => null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      if (deps.signal?.aborted) throw new Error('已取消');
      const url = urls[i];
      const bytes = await getBytes(url, deps.fetcher, refererFor(url, deps.platform), deps.signal);
      if (bytes && bytes.length >= MIN_IMAGE_BYTES) {
        const name = `${prefix}_${String(i + 1).padStart(2, '0')}.${sniffExt(bytes, url)}`;
        await deps.io.writeBytes(deps.io.join(dir, name), bytes);
        results[i] = `${sub}/${name}`;
      }
      deps.onEach?.(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
  return { saved: results.filter((x): x is string => !!x), failed: urls.filter((_, i) => !results[i]) };
}
