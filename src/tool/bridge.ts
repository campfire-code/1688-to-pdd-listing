// 应用主窗口与拼多多窗口之间的通道：调用注入脚本里的函数，等它用事件回报结果。
export interface PddBridge {
  call<T = unknown>(fn: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

type Unlisten = () => void;
export interface BridgeEnv {
  invoke(cmd: string, args: Record<string, unknown>): Promise<unknown>;
  listen(event: string, handler: (e: { payload: unknown }) => void): Promise<Unlisten>;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

interface Waiter { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }

export function createBridge(env: BridgeEnv): PddBridge {
  const waiters = new Map<string, Waiter>();
  let ready: Promise<void> | null = null;
  let seq = 0;
  const st = env.setTimeout ?? setTimeout;
  const ct = env.clearTimeout ?? clearTimeout;
  const ensure = () => (ready ??= env.listen('pdd-result', (e) => {
    const p = e.payload as { id?: string; ok?: boolean; data?: unknown; error?: string };
    const w = p?.id ? waiters.get(p.id) : undefined;
    if (!w) return;
    waiters.delete(p.id!);
    ct(w.timer);
    if (p.ok) w.resolve(p.data); else w.reject(new Error(p.error || '页面里的操作失败'));
  }).then(() => undefined));

  return {
    async call<T>(fn: string, args: Record<string, unknown> = {}, timeoutMs = 20000): Promise<T> {
      await ensure();
      const id = `c${++seq}`;
      return new Promise<T>((resolve, reject) => {
        const timer = st(() => {
          waiters.delete(id);
          reject(new Error(`拼多多窗口 ${Math.round(timeoutMs / 1000)} 秒没有响应（页面可能正在跳转，或窗口已关闭）`));
        }, timeoutMs);
        waiters.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        env.invoke('call_pdd', { callId: id, func: fn, argsJson: JSON.stringify(args) }).catch((e) => {
          waiters.delete(id);
          ct(timer);
          reject(new Error(String(e)));
        });
      });
    },
  };
}

export async function tauriBridge(): Promise<PddBridge> {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
  return createBridge({ invoke: (c, a) => invoke(c, a), listen: (ev, h) => listen(ev, h) });
}

/** 把图片字节切成块发进拼多多窗口（每块 180000 字节，是 3 的倍数，拼接后的 base64 才是合法的） */
export const CHUNK_BYTES = 180_000;
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const mimeOf = (name: string) => (/\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg');

export async function sendImage(bridge: PddBridge, key: string, name: string, bytes: Uint8Array): Promise<void> {
  await bridge.call('imgBegin', { key, name, mime: mimeOf(name) });
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
    await bridge.call('imgChunk', { key, data: toBase64(bytes.subarray(i, i + CHUNK_BYTES)) }, 30000);
  }
}
