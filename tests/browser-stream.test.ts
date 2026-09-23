import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import { BrowserStream, jpegDimensions } from '../server/browser-stream.js';

// A minimal JPEG header is enough to exercise encoded geometry validation.
function jpeg(width: number, height: number) {
  const image = Buffer.from('ffd8ffc00011080000000003012200021101031101ffd9', 'hex');
  image.writeUInt16BE(height, 7); image.writeUInt16BE(width, 9); return image;
}
function fixture() {
  const cdp = Object.assign(new EventEmitter(), { send: vi.fn(async (_name: string, _params?: unknown) => ({})), detach: vi.fn(async () => {}) });
  const page = Object.assign(new EventEmitter(), { context: () => ({ newCDPSession: vi.fn(async () => cdp) }), viewportSize: vi.fn(() => ({ width: 640, height: 480 })), screenshot: vi.fn(async () => jpeg(640, 480)), url: () => 'https://example.test/' });
  const stream = new BrowserStream(page as unknown as Page, () => ({ tabId: 'one', title: 'Example' }));
  return { cdp, page, stream };
}
afterEach(() => vi.useRealTimers());
describe('browser compositor stream', () => {
  it('recognizes dimensions and refuses truncated or invalid JPEG headers', () => {
    expect(jpegDimensions(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    for (const input of [Buffer.from('not a jpeg'), jpeg(640, 480).subarray(0, 10), Buffer.from('ffd8ffc00000', 'hex')]) expect(jpegDimensions(input)).toBeNull();
  });
  it('shares its capture, coalesces animation frames, and detaches after its last viewer leaves', async () => {
    vi.useFakeTimers();
    const { stream, cdp, page } = fixture(), one = vi.fn(), two = vi.fn(), ended = vi.fn();
    const first = stream.subscribe(one, ended), second = stream.subscribe(two, ended);
    await vi.advanceTimersByTimeAsync(201);
    expect(one).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'one', width: 640, height: 480 }));
    expect(two).toHaveBeenCalledOnce(); expect(page.screenshot).toHaveBeenCalledOnce();
    expect(cdp.send.mock.calls.filter(([name]) => name === 'Page.startScreencast')).toHaveLength(1);
    // Chromium reuses one session ID for every frame in the same screencast.
    for (const sessionId of [1, 1, 1]) cdp.emit('Page.screencastFrame', { sessionId, data: jpeg(640, 480).toString('base64') });
    expect(one).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(80);
    expect(one).toHaveBeenCalledTimes(2); expect(cdp.send.mock.calls.filter(([name]) => name === 'Page.screencastFrameAck')).toHaveLength(3);
    first(); expect(cdp.detach).not.toHaveBeenCalled(); second(); await stream.close();
    expect(cdp.detach).toHaveBeenCalledOnce(); expect(cdp.listenerCount('Page.screencastFrame')).toBe(0); expect(page.listenerCount('close')).toBe(0);
    expect(ended).not.toHaveBeenCalled();
  });
  it('never relabels an old compositor image with resized viewport dimensions', async () => {
    vi.useFakeTimers(); const { stream, cdp, page } = fixture(), frame = vi.fn(); stream.subscribe(frame, vi.fn());
    await vi.advanceTimersByTimeAsync(201); page.viewportSize.mockReturnValue({ width: 500, height: 700 });
    cdp.emit('Page.screencastFrame', { sessionId: 1, data: jpeg(640, 480).toString('base64') }); await vi.advanceTimersByTimeAsync(80);
    expect(frame).toHaveBeenCalledOnce();
    cdp.emit('Page.screencastFrame', { sessionId: 2, data: jpeg(500, 700).toString('base64') }); await vi.advanceTimersByTimeAsync(80);
    expect(frame).toHaveBeenLastCalledWith(expect.objectContaining({ width: 500, height: 700 })); await stream.close();
  });
  it('ends viewers on page close, bounds viewers, and cleans up a late connection', async () => {
    const { stream, page, cdp } = fixture(), ends = Array.from({ length: 4 }, () => vi.fn());
    ends.forEach(end => stream.subscribe(vi.fn(), end));
    expect(() => stream.subscribe(vi.fn(), vi.fn())).toThrow('four live viewers');
    page.emit('close'); await stream.close();
    expect(cdp.detach).toHaveBeenCalledOnce(); for (const end of ends) expect(end).toHaveBeenCalledOnce();
    expect(() => stream.subscribe(vi.fn(), vi.fn())).toThrow('stopped');
  });
  it('detaches promptly even when its fallback screenshot is still pending', async () => {
    vi.useFakeTimers(); const { stream, page, cdp } = fixture(); let finish!: (image: ReturnType<typeof jpeg>) => void;
    page.screenshot.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const frames = vi.fn(), stop = stream.subscribe(frames, vi.fn());
    await vi.advanceTimersByTimeAsync(201); expect(page.screenshot).toHaveBeenCalledOnce();
    stop(); await stream.close(); expect(cdp.detach).toHaveBeenCalledOnce();
    finish(jpeg(640, 480)); await vi.advanceTimersByTimeAsync(0); expect(frames).not.toHaveBeenCalled();
  });
});
