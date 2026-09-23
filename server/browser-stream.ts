import type { CDPSession, Page } from 'playwright';
import type { BrowserFrame } from '../shared/browser.js';

type Listener = { frame: (frame: BrowserFrame) => void; end: () => void };
type CastFrame = { data: string; sessionId: number };

/** Read the encoded dimensions, including during a compositor resize. */
export function jpegDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= data.length && data[offset] === 0xff) {
    const marker = data[offset + 1], length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return null;
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    }
    offset += length + 2;
  }
  return null;
}

/** One compositor stream per open page, shared by its visible viewers. */
export class BrowserStream {
  private listeners = new Set<Listener>();
  private cdp?: CDPSession;
  private pending?: CastFrame;
  private acknowledgements = new Map<number, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private initialCapture?: ReturnType<typeof setTimeout>;
  private latest?: BrowserFrame;
  private started: Promise<void>;
  private stopping?: Promise<void>;
  private stopped = false;
  get closed() { return this.stopped; }

  constructor(private page: Page, private metadata: () => Pick<BrowserFrame, 'tabId' | 'title'>) {
    page.once('close', this.onClose);
    this.started = this.start();
    void this.started.catch(() => this.close());
  }

  subscribe(frame: Listener['frame'], end: Listener['end']): () => void {
    if (this.stopped) throw new Error('The browser preview has stopped.');
    if (this.listeners.size >= 4) throw new Error('This page already has four live viewers.');
    const listener = { frame, end }; this.listeners.add(listener);
    if (this.latest) frame(this.latest);
    return () => { this.listeners.delete(listener); if (!this.listeners.size) void this.close(); };
  }

  private onClose = () => { void this.close(); };
  private onFrame = (frame: CastFrame) => {
    if (this.stopped) return;
    this.pending = frame; this.acknowledgements.set(frame.sessionId, (this.acknowledgements.get(frame.sessionId) ?? 0) + 1);
    // Acknowledge at the delivery cadence. Chromium retains only its small
    // in-flight window; a fast animation cannot fill an unbounded frame queue.
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 80);
  };
  private flush() {
    this.timer = undefined;
    const pending = this.pending; this.pending = undefined;
    const acknowledgements = [...this.acknowledgements]; this.acknowledgements.clear();
    if (pending) this.publish(pending.data);
    // sessionId identifies the screencast, not an individual frame. Coalesced
    // images still need one acknowledgement each or Chromium's window fills.
    for (const [sessionId, count] of acknowledgements) for (let index = 0; index < count; index++) void this.cdp?.send('Page.screencastFrameAck', { sessionId }).catch(() => this.close());
  }
  private publish(data: string) {
    if (this.stopped || data.length > 4_000_000) return;
    const size = jpegDimensions(Buffer.from(data, 'base64')), viewport = this.page.viewportSize();
    // Old compositor frames can arrive after setViewportSize. Never label an
    // old image with the new dimensions used to translate pointer positions.
    if (!size || !viewport || size.width !== viewport.width || size.height !== viewport.height) return;
    this.latest = { ...this.metadata(), ...size, data, pageUrl: this.page.url(), capturedAt: Date.now() };
    for (const listener of this.listeners) listener.frame(this.latest);
  }
  private async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    if (this.stopped) return;
    this.cdp.on('Page.screencastFrame', this.onFrame);
    this.cdp.on('close', this.onClose);
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 78, everyNthFrame: 1 });
    // Give the compositor its first frame before falling back to one capture.
    // Do not make detach wait for a screenshot: a resize or hidden pane must
    // release its stream promptly even if Chromium is still preparing a frame.
    if (!this.stopped) this.initialCapture = setTimeout(() => {
      if (this.stopped || this.latest) return;
      void this.page.screenshot({ type: 'jpeg', quality: 78, timeout: 5000 }).then(image => { if (!this.latest) this.publish(image.toString('base64')); }).catch(() => { if (!this.latest) void this.close(); });
    }, 200);
  }
  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.stopped) return Promise.resolve();
    this.stopped = true; this.page.removeListener('close', this.onClose);
    clearTimeout(this.timer); clearTimeout(this.initialCapture); this.pending = undefined; this.latest = undefined; this.acknowledgements.clear();
    for (const listener of this.listeners) listener.end();
    this.listeners.clear();
    this.stopping = (async () => {
      await this.started.catch(() => {});
      this.cdp?.removeListener('Page.screencastFrame', this.onFrame);
      this.cdp?.removeListener('close', this.onClose);
      await this.cdp?.send('Page.stopScreencast').catch(() => {});
      await this.cdp?.detach().catch(() => {});
    })();
    return this.stopping;
  }
}
