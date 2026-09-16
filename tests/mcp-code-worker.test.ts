import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sandbox = vi.hoisted(() => {
  const handle = { dispose: vi.fn() };
  const success = () => ({ value: handle, dispose: vi.fn() });
  const callbacks = new Map<string, (...args: unknown[]) => unknown>();
  const vm = {
    global: {}, setProp: vi.fn(), getString: String, getNumber: Number,
    newFunction: (name: string, callback: (...args: unknown[]) => unknown) => {
      callbacks.set(name, callback);
      return { consume: (use: (value: unknown) => void) => use(handle) };
    },
    newPromise: () => ({ handle }),
    evalCode: vi.fn<() => { value?: typeof handle; error?: typeof handle; dispose(): void }>(success),
    dump: vi.fn(() => ({ message: 'incidental engine error' })),
  };
  const runtime = {
    setMemoryLimit: vi.fn(), setMaxStackSize: vi.fn(), newContext: () => vm,
    setInterruptHandler: vi.fn<(handler: () => boolean) => void>(),
    executePendingJobs: vi.fn<() => { value?: number; error?: typeof handle; dispose(): void }>(() => ({ value: 0, dispose: vi.fn() })),
  };
  return { vm, runtime, callbacks, handle, success, port: { postMessage: vi.fn(), on: vi.fn() } };
});

vi.mock('node:worker_threads', () => ({
  parentPort: sandbox.port,
  workerData: { code: 'return 1;', names: [], limits: { cpuMs: 20, memoryBytes: 64 * 1024 * 1024, outputBytes: 1024 } },
}));
vi.mock('quickjs-emscripten', () => ({ getQuickJS: async () => ({ newRuntime: () => sandbox.runtime }) }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); sandbox.callbacks.clear();
  sandbox.vm.evalCode.mockReset().mockImplementation(sandbox.success);
  sandbox.runtime.executePendingJobs.mockReset().mockImplementation(() => ({ value: 0, dispose: vi.fn() }));
  vi.spyOn(performance, 'now').mockReturnValue(0);
});
afterEach(() => { vi.restoreAllMocks(); });

const interrupt = () => {
  vi.mocked(performance.now).mockReturnValue(21);
  expect(sandbox.runtime.setInterruptHandler.mock.calls[0][0]()).toBe(true);
};
const expectCpuLimit = () => {
  expect(sandbox.port.postMessage).toHaveBeenCalledWith({ type: 'done', error: 'MCP code execution exceeded the CPU time limit.' });
  expect(sandbox.port.postMessage.mock.calls.filter(([message]) => message.type === 'done')).toHaveLength(1);
  expect(sandbox.vm.dump).not.toHaveBeenCalled();
};

describe('CPU interruption completion paths', () => {
  it.each([false, true])('stops an error-free job drain with pending host call = %s', async pending => {
    sandbox.runtime.executePendingJobs.mockImplementation(() => {
      if (pending) sandbox.callbacks.get('__call')!('read', '{}');
      interrupt();
      // The cause stays latched even if a later slice resets its clock.
      vi.mocked(performance.now).mockReturnValue(0);
      expect(sandbox.runtime.setInterruptHandler.mock.calls[0][0]()).toBe(true);
      return { value: 0, dispose: vi.fn() };
    });
    await import('../server/mcp-code-worker.js');
    expectCpuLimit();
  });

  it.each([0, 1])('overrides a guest completion during the interrupted job drain (ok = %s)', async ok => {
    sandbox.runtime.executePendingJobs.mockImplementation(() => {
      interrupt();
      sandbox.callbacks.get('__done')!(ok, ok ? '1' : 'TypeError: not a function');
      return { value: 1, dispose: vi.fn() };
    });
    await import('../server/mcp-code-worker.js');
    expectCpuLimit();
  });

  it.each(['evaluate', 'pump'])('disposes an interrupted %s error without formatting it', async phase => {
    const dispose = vi.fn();
    const fail = () => { interrupt(); return { error: sandbox.handle, dispose }; };
    if (phase === 'evaluate') sandbox.vm.evalCode.mockImplementation(fail);
    else sandbox.runtime.executePendingJobs.mockImplementation(fail);
    await import('../server/mcp-code-worker.js');
    expectCpuLimit(); expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps a genuinely unresolvable promise distinct from CPU exhaustion', async () => {
    await import('../server/mcp-code-worker.js');
    expect(sandbox.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'done', error: 'Script is waiting on a promise that cannot resolve.' });
  });

  it('preserves a guest error when the CPU interrupt did not fire', async () => {
    sandbox.runtime.executePendingJobs.mockImplementation(() => {
      sandbox.callbacks.get('__done')!(0, 'TypeError: ordinary script error');
      return { value: 1, dispose: vi.fn() };
    });
    await import('../server/mcp-code-worker.js');
    expect(sandbox.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'done', error: 'TypeError: ordinary script error' });
  });
});
