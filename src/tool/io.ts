// 本机文件与网络的最小接口：产品库、图片下载、导出都只依赖这里，测试时换成内存版本。
export interface FileIO {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** 文件夹里的名字（不含路径） */
  list(path: string): Promise<string[]>;
  remove(path: string, recursive?: boolean): Promise<void>;
  join(...parts: string[]): string;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}
export type Fetcher = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<HttpResponse>;

/** 真实环境的文件实现（Tauri 的 fs 插件）。路径分隔符按系统，用 / 拼接在两个系统上都能被 fs 插件识别。 */
export async function tauriFileIO(): Promise<FileIO> {
  const fsp = await import('@tauri-apps/plugin-fs');
  const join = (...parts: string[]) => parts.join('/').replace(/([^:])\/{2,}/g, '$1/');
  return {
    readText: (p) => fsp.readTextFile(p),
    writeText: (p, t) => fsp.writeTextFile(p, t),
    readBytes: (p) => fsp.readFile(p),
    writeBytes: (p, d) => fsp.writeFile(p, d),
    exists: (p) => fsp.exists(p),
    mkdir: (p) => fsp.mkdir(p, { recursive: true }),
    list: async (p) => (await fsp.readDir(p)).map((e) => e.name),
    remove: (p, recursive) => fsp.remove(p, { recursive: !!recursive }),
    join,
  };
}
