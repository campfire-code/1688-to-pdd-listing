import { describe, expect, it, vi } from 'vitest';
import { CHUNK_BYTES, createBridge, mimeOf, sendImage, toBase64, type BridgeEnv } from './bridge';

function env() {
  let handler: (e: { payload: unknown }) => void = () => {};
  const invoked: { cmd: string; args: Record<string, unknown> }[] = [];
  const e: BridgeEnv = {
    invoke: async (cmd, args) => { invoked.push({ cmd, args }); },
    listen: async (_ev, h) => { handler = h; return () => {}; },
  };
  return { e, invoked, emit: (payload: unknown) => handler({ payload }) };
}

describe('通道', () => {
  it('按调用编号对应结果；错误会抛出', async () => {
    const { e, invoked, emit } = env();
    const b = createBridge(e);
    const p1 = b.call<{ a: number }>('probe', { x: 1 });
    const p2 = b.call('fillTitle', { title: 't' });
    await vi.waitFor(() => expect(invoked).toHaveLength(2));
    expect(invoked[0]).toEqual({ cmd: 'call_pdd', args: { callId: 'c1', func: 'probe', argsJson: '{"x":1}' } });
    emit({ id: 'c2', ok: false, error: '没找到输入框' });
    emit({ id: 'c1', ok: true, data: { a: 1 } });
    expect(await p1).toEqual({ a: 1 });
    await expect(p2).rejects.toThrow('没找到输入框');
  });
  it('超时：页面没有响应时报错而不是一直等', async () => {
    vi.useFakeTimers();
    const { e } = env();
    const p = createBridge(e).call('probe', {}, 1000);
    const assertion = expect(p).rejects.toThrow('没有响应');
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    vi.useRealTimers();
  });
  it('未知编号的结果被忽略；命令调用失败时抛错', async () => {
    const { e, emit } = env();
    e.invoke = async () => { throw new Error('还没有打开拼多多商家后台窗口'); };
    const b = createBridge(e);
    emit({ id: 'zzz', ok: true });
    await expect(b.call('probe')).rejects.toThrow('还没有打开');
  });
  it('图片分块：每块是 3 的倍数字节，拼起来能还原', async () => {
    expect(CHUNK_BYTES % 3).toBe(0);
    const bytes = Uint8Array.from({ length: CHUNK_BYTES * 2 + 5 }, (_, i) => i % 251);
    const sent: { fn: string; args: Record<string, unknown> }[] = [];
    await sendImage({ call: async (fn, args) => { sent.push({ fn, args: args ?? {} }); return undefined as never; } }, 'k', 'a.png', bytes);
    expect(sent.map((s) => s.fn)).toEqual(['imgBegin', 'imgChunk', 'imgChunk', 'imgChunk']);
    expect(sent[0].args).toMatchObject({ key: 'k', name: 'a.png', mime: 'image/png' });
    const joined = Buffer.from(sent.slice(1).map((s) => s.args.data as string).join(''), 'base64');
    expect(Array.from(joined)).toEqual(Array.from(bytes));
  });
  it('base64 与 mime', () => {
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
    expect([mimeOf('a.PNG'), mimeOf('a.webp'), mimeOf('a.jpg')]).toEqual(['image/png', 'image/webp', 'image/jpeg']);
  });
});
