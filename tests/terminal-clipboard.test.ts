import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { attachmentFromClipboard } from '../tui/terminalIO.js';

function subprocess() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn> };
  child.stdout = new EventEmitter(); child.kill = vi.fn(); spawnMock.mockReturnValue(child); return child;
}

afterEach(() => vi.clearAllMocks());

describe('terminal clipboard images', () => {
  it('turns a native PNG clipboard payload into an attachment', async () => {
    const child = subprocess(), pending = attachmentFromClipboard();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    child.stdout.emit('data', png); child.emit('close', 0);
    await expect(pending).resolves.toEqual({ name: 'clipboard-image.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}` });
    expect(spawnMock).toHaveBeenCalledWith(process.platform === 'darwin' ? 'osascript' : 'wl-paste', expect.any(Array), { stdio: ['ignore', 'pipe', 'ignore'] });
  });

  it('rejects clipboard images above the attachment limit', async () => {
    const child = subprocess(), pending = attachmentFromClipboard();
    child.stdout.emit('data', Buffer.alloc(4_400_001));
    await expect(pending).rejects.toThrow('Clipboard images must be smaller than 4.4 MB.');
    expect(child.kill).toHaveBeenCalled();
  });
});
