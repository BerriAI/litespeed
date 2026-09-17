import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Sidecars, validateSidecars, type SidecarDecision } from '../server/sidecars.js';
import { SIDECAR_LIMITS, type SidecarConfig } from '../shared/sidecars.js';

// Every sidecar here is a REAL node -e process speaking newline-delimited
// JSON-RPC 2.0 over stdio; only the host deadline clock is controlled.
// The JS bodies use double quotes only so bash -c single-quoting stays trivial.
const responder = (body: string) => `node -e 'const rl=require("readline").createInterface({input:process.stdin});rl.on("line",l=>{const m=JSON.parse(l);${body}})'`;
const passer = responder('console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{action:"pass"}}))');
const config = (command: string, name = 'test-sidecar'): SidecarConfig => ({ name, command, events: ['tool_call'] });
const payload = { sessionId: 's1', tool: 'write_file', args: { path: 'x.txt', content: 'original' } };
const until = async (check: () => boolean | Promise<boolean>) => { const deadline = Date.now() + 5000; while (!(await check())) { if (Date.now() > deadline) throw new Error('Timed out'); await sleep(20); } };

describe('Sidecars unit: spawn, protocol, failure posture', () => {
  let directory: string, sidecars: Sidecars;
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'litespeed-sidecars-')));
    sidecars = new Sidecars();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(async () => { vi.useRealTimers(); sidecars.stopAll(); await rm(directory, { recursive: true, force: true }); });

  it('spawns lazily and round-trips pass, modify, and block through JSON-RPC', async () => {
    const script = responder('const a=m.params.args.action;console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:a==="modify"?{action:"modify",args:{...m.params.args,content:"changed"},reason:"why"}:a==="block"?{action:"block",reason:"nope"}:{action:"pass"}}))');
    const cfg = config(script);
    expect(await sidecars.intercept(cfg, { ...payload, args: { action: 'pass' } })).toEqual({ action: 'pass' });
    expect(await sidecars.intercept(cfg, { ...payload, args: { action: 'modify', content: 'v' } })).toEqual({ action: 'modify', args: { action: 'modify', content: 'changed' }, reason: 'why' });
    expect(await sidecars.intercept(cfg, { ...payload, args: { action: 'block' } })).toEqual({ action: 'block', reason: 'nope' });
  });

  it('delivers the exact JSON-RPC request shape on stdin', async () => {
    const seen = join(directory, 'seen.jsonl');
    const cfg = config(responder(`require("fs").appendFileSync(${JSON.stringify(seen)},l+"\\n");console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{action:"pass"}}))`));
    await sidecars.intercept(cfg, payload);
    const line = JSON.parse((await readFile(seen, 'utf8')).trim());
    expect(line).toEqual({ jsonrpc: '2.0', id: 1, method: 'tool_call', params: { sessionId: 's1', tool: 'write_file', args: { path: 'x.txt', content: 'original' } } });
  });

  it.each(['silent', 'noisy'])('a %s sidecar times out at the deadline and is reused', async mode => {
    const seen = join(directory, 'seen.jsonl');
    const cfg = config(responder(`${mode === 'noisy' ? 'console.log("just some logging");' : ''}require("fs").appendFileSync(${JSON.stringify(seen)},JSON.stringify({id:m.id,pid:process.pid})+"\\n")`));
    for (const id of [1, 2]) {
      const settled = vi.fn();
      const execution = sidecars.intercept(cfg, payload).then(decision => { settled(decision); return decision; });
      await until(async () => existsSync(seen) && (await readFile(seen, 'utf8')).split('\n').length === id + 1);
      await vi.advanceTimersByTimeAsync(SIDECAR_LIMITS.timeoutMs - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledTimes(1);
      expect(await execution).toEqual({ action: 'pass', warn: expect.stringContaining(`did not respond within ${SIDECAR_LIMITS.timeoutMs / 1000}s`) });
    }
    const receipts = (await readFile(seen, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(receipts).toEqual([{ id: 1, pid: expect.any(Number) }, { id: 2, pid: receipts[0].pid }]);
  });

  it.each([
    { name: 'bad-action', response: { result: { action: 'transmute' } }, warn: 'malformed' },
    { name: 'long-reason', response: { result: { action: 'block', reason: 'x'.repeat(SIDECAR_LIMITS.reasonChars + 1) } }, warn: 'malformed' },
    { name: 'modify-no-args', response: { result: { action: 'modify', reason: 'r' } }, warn: 'malformed' },
    { name: 'rpc-error', response: { error: { code: -32000, message: 'boom' } }, warn: 'JSON-RPC error' },
  ])('reports $warn for $name without racing the subprocess', async ({ name, response, warn }) => {
    sidecars.timeoutMs = 300;
    const cfg = config(responder(`setTimeout(()=>console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,...${JSON.stringify(response)}})),400)`), name);
    expect(await sidecars.intercept(cfg, payload)).toEqual({ action: 'pass', warn: expect.stringContaining(warn) });
  });

  it('a crashing sidecar warns, respawns on next use, and is disabled after the respawn cap', async () => {
    const cfg = config(`node -e 'process.exit(7)'`, 'crasher');
    // First spawn + the 3 allowed respawns: each attempt warns and passes.
    for (let attempt = 0; attempt < 1 + SIDECAR_LIMITS.respawns; attempt++) {
      const decision = await sidecars.intercept(cfg, payload);
      expect(decision.action).toBe('pass');
      expect((decision as { warn?: string }).warn).toContain('crashed');
    }
    // The budget is spent: one disabled notice, then silence for the process lifetime.
    const disabled = await sidecars.intercept(cfg, payload);
    expect(disabled).toEqual({ action: 'pass', warn: expect.stringContaining('disabled') });
    expect(await sidecars.intercept(cfg, payload)).toEqual({ action: 'pass' });
  });

  it('an unspawnable command is a pass with a warn, never a throw', async () => {
    const decision = await sidecars.intercept(config('exec /nonexistent/definitely-not-a-binary', 'broken'), payload);
    expect(decision).toEqual({ action: 'pass', warn: expect.stringContaining('crashed before answering') });
  });

  it('stopAll kills the long-lived process', async () => {
    const pidFile = join(directory, 'pid');
    const cfg = config(`node -e 'require("fs").writeFileSync(${JSON.stringify(pidFile)},String(process.pid));const rl=require("readline").createInterface({input:process.stdin});rl.on("line",l=>{const m=JSON.parse(l);console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{action:"pass"}}))})'`);
    expect(await sidecars.intercept(cfg, payload)).toEqual({ action: 'pass' });
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    expect(() => process.kill(pid, 0)).not.toThrow(); // Alive between calls: long-lived.
    sidecars.stopAll();
    await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  });

  it('a config edit (same name, new command) restarts without spending the respawn budget', async () => {
    const first = config(passer, 'editable');
    expect(await sidecars.intercept(first, payload)).toEqual({ action: 'pass' });
    const edited = config(responder('console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{action:"block",reason:"new build"}}))'), 'editable');
    expect(await sidecars.intercept(edited, payload)).toEqual({ action: 'block', reason: 'new build' });
  });

  it('validateSidecars enforces the cap, slug names, uniqueness, and command bound', () => {
    expect(() => validateSidecars(Array.from({ length: 4 }, (_, i) => config('x', `s-${i}`)))).toThrow(/Invalid sidecars/);
    expect(() => validateSidecars([config('x', 'Bad Name')])).toThrow(/slug/);
    expect(() => validateSidecars([config('x', 'a'), config('y', 'a')])).toThrow(/unique/);
    expect(() => validateSidecars([config('x'.repeat(SIDECAR_LIMITS.commandChars + 1))])).toThrow(/Invalid sidecars/);
    expect(() => validateSidecars([{ ...config('x'), events: [] }])).toThrow(/Invalid sidecars/);
    expect(() => validateSidecars([{ ...config('x'), events: ['tool_call', 'tool_call'] }])).toThrow(/Invalid sidecars/);
    const valid: SidecarConfig[] = [config('echo hi', 'one'), config('echo hi', 'two'), config('echo hi', 'three')];
    expect(validateSidecars(valid)).toEqual(valid);
    const decisionShape: SidecarDecision = { action: 'pass' }; // Type-only sanity.
    expect(decisionShape.action).toBe('pass');
  });
});
