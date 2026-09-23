import { describe, expect, it, vi } from 'vitest';
import { executeMcpCode, McpCodeDenied, type McpCodeOptions } from '../server/mcp-code.js';

const run = (code: string, extra: Partial<McpCodeOptions> = {}) => executeMcpCode({ code, names: [], signal: new AbortController().signal, invoke: async () => ({ content: [] }), ...extra });

describe('isolated TypeScript MCP execution', () => {
  it('transpiles TypeScript types, enums and async return values', async () => {
    expect(JSON.parse(await run('enum State { Pending, Done }; interface Row { state: State }; const rows: Row[] = [{state: State.Pending}]; return rows.filter((row: Row) => row.state === State.Pending).length;'))).toBe(1);
  });

  it('does not charge approval review time to the execution budget',async()=>{
    const output=await run('await tools.read({}); return "done";',{
      names:['read'],limits:{timeoutMs:4000},
      invoke:async(_name,_args,_signal,approvalWait)=>{
        approvalWait(true);await new Promise(resolve=>setTimeout(resolve,4500));approvalWait(false);
        return {content:[]};
      },
    });
    expect(JSON.parse(output)).toBe('done');
  },15000);

  it('passes large intermediate data between tools without returning it to the model', async () => {
    const document = 'PRIVATE_TRANSCRIPT '.repeat(20_000);
    const invoke = vi.fn<McpCodeOptions['invoke']>(async (name, args) => {
      if (name === 'read') return { content: [], structuredContent: { document } };
      expect(args).toEqual({ document }); return { content: [], structuredContent: { saved: true } };
    });
    const output = await run('const doc = (await tools.read({})).structuredContent.document; await tools.write({document: doc}); return {saved: true};', { names: ['read', 'write'], invoke });
    expect(JSON.parse(output)).toEqual({ saved: true }); expect(output).not.toContain('PRIVATE_TRANSCRIPT'); expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('supports bounded parallel calls and preserves Promise.all result order', async () => {
    let active = 0, maximum = 0;
    const invoke: McpCodeOptions['invoke'] = async (_name, args) => {
      maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 10)); active--;
      return { content: [], structuredContent: { index: args.index } };
    };
    const output = await run('return (await Promise.all(Array.from({length: 9}, (_, index) => tools.echo({index})))).map(item => item.structuredContent.index);', { names: ['echo'], invoke });
    expect(JSON.parse(output)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]); expect(maximum).toBe(4);
  });

  it('terminates on denial even when the script tries to catch it', async () => {
    const invoke = vi.fn<McpCodeOptions['invoke']>(async () => { throw new McpCodeDenied('Denied by user'); });
    await expect(run('try { await tools.write({}); } catch {} await tools.write({retry: true});', { names: ['write'], invoke })).rejects.toThrow(McpCodeDenied);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not expose Node, network, modules or the private bridge', async () => {
    const output = await run('return [typeof process, typeof require, typeof fetch, typeof __call, typeof __done, typeof setTimeout, Function("return typeof process")()];');
    expect(JSON.parse(output)).toEqual(Array(7).fill('undefined'));
    await expect(run('return await import("node:fs");')).rejects.toThrow();
  });

  it('cannot call tools outside the frozen catalog or inherited object methods', async () => {
    const invoke = vi.fn<McpCodeOptions['invoke']>();
    await expect(run('await tools.missing({});', { names: ['read'], invoke })).rejects.toThrow();
    expect(await run('return typeof tools.constructor;')).toContain('undefined');
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    'while (true) {}',
    'while (true) { await Promise.resolve(); }',
    'await tools.read({}); while (true) { await Promise.resolve(); }',
  ])('reports CPU exhaustion for %s', async code => {
    await expect(run(code, { names: ['read'], signal: AbortSignal.timeout(10_000), limits: { cpuMs: 20 } })).rejects.toThrow('MCP code execution exceeded the CPU time limit.');
    expect(await run('return "still usable";')).toContain('still usable');
  });

  it('preserves the CPU-limit error and cancels a pending host call', async () => {
    let aborted = false;
    const invoke: McpCodeOptions['invoke'] = async (_name, _args, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true });
    });
    await expect(run('tools.read({}); while (true) { await Promise.resolve(); }', {
      names: ['read'], invoke, signal: AbortSignal.timeout(10_000), limits: { cpuMs: 100 },
    })).rejects.toThrow('MCP code execution exceeded the CPU time limit.');
    expect(aborted).toBe(true);
  });

  it('reports invalid syntax without making calls', async () => {
    const invoke = vi.fn<McpCodeOptions['invoke']>();
    await expect(run('const x = ; await tools.write({});', { names: ['write'], invoke })).rejects.toThrow(/Expression expected/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects an allocation above the guest memory limit but permits it with sufficient memory', async () => {
    const code = 'const bytes = new ArrayBuffer(8 * 1024 * 1024); await tools.write({}); return bytes.byteLength;';
    const invoke = vi.fn<McpCodeOptions['invoke']>(async () => ({ content: [] }));
    await expect(run(code, { names: ['write'], invoke, limits: { memoryBytes: 2 * 1024 * 1024 } })).rejects.toThrow(/out of memory/i);
    expect(invoke).not.toHaveBeenCalled();
    expect(JSON.parse(await run(code, { names: ['write'], invoke }))).toBe(8 * 1024 * 1024);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('stops unawaited calls and promises with no possible completion', async () => {
    await expect(run('await new Promise(() => {});')).rejects.toThrow(/cannot resolve/);
    await expect(run('tools.read({}); return "done";', { names: ['read'] })).rejects.toThrow(/Await every tool call/);
  });

  it('cancels in-flight calls and cleans up their signal', async () => {
    const controller = new AbortController();
    let aborted = false;
    const invoke: McpCodeOptions['invoke'] = async (_name, _args, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true });
      controller.abort();
    });
    await expect(run('await tools.read({});', { names: ['read'], invoke, signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(aborted).toBe(true);
  });

  it('expires the execution deadline and cancels a pending host call', async () => {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    let aborted = false;
    const invoke: McpCodeOptions['invoke'] = async (_name, _args, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true });
      markStarted();
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const execution = run('await tools.read({});', {
      names: ['read'], invoke, limits: { timeoutMs: 1000 },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    }).then(output => output, (error: Error) => error);
    try {
      await Promise.race([started, execution.then(result => { throw new Error(`Execution ended before the host call started: ${result}`); })]);
      vi.advanceTimersByTime(999);
      expect(aborted).toBe(false);
      vi.advanceTimersByTime(1);
      expect(aborted).toBe(true);
      expect(await execution).toEqual(expect.objectContaining({ message: expect.stringMatching(/timed out/) }));
    } finally {
      controller.abort();
      await execution;
      vi.useRealTimers();
    }
  }, 30_000);

  it('limits call count, argument size, result size, and emitted UTF-8 output', async () => {
    const invoke = vi.fn<McpCodeOptions['invoke']>(async () => ({ content: [{ type: 'text', text: 'large result' }] }));
    await expect(run('for (let i = 0; i < 3; i++) await tools.read({});', { names: ['read'], invoke, limits: { calls: 2 } })).rejects.toThrow(/call limit/);
    expect(invoke).toHaveBeenCalledTimes(2);
    await expect(run('await tools.read({text: "x".repeat(100)});', { names: ['read'], limits: { argumentBytes: 50 } })).rejects.toThrow(/arguments exceed/);
    await expect(run('await tools.read({});', { names: ['read'], invoke, limits: { resultBytes: 10 } })).rejects.toThrow(/result exceeds/);
    const output = await run('console.log("界".repeat(1000)); return "extra";', { limits: { outputBytes: 100 } });
    expect(output).toContain('Output truncated'); expect(output).not.toContain('�'); expect(Buffer.byteLength(output)).toBeLessThan(200);
  });
});
