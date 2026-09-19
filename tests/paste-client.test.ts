// @vitest-environment jsdom
import { act } from 'react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { Composer } from '../client/src/Composer.js';
import type { Settings } from '../shared/types.js';

const settings: Settings = {
  providers: [{ id: 'test', name: 'Test', kind: 'openai', baseUrl: 'http://127.0.0.1:9' }],
  defaultProvider: 'test', defaultModel: 'model', workspace: '/tmp', permissionMode: 'ask', maxSteps: 40, theme: 'system', mcpServers: {},
};

describe('composer clipboard paste', () => {
  let root: Root, container: HTMLElement;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('turns a pasted image into an image attachment', async () => {
    const setAttachments = vi.fn();
    await act(async () => {
      root.render(React.createElement(Composer, {
        settings, selection: { providerId: 'test', model: 'model', mode: 'build' }, onSelection: () => {},
        onSend: async () => true, onCancel: () => {}, running: false, disabled: false, workspace: '/tmp',
        text: '', setText: () => {}, attachments: [], setAttachments, onSettings: () => {},
      } as any));
    });

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'Screenshot.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [file] } });
    await act(async () => { container.querySelector<HTMLTextAreaElement>('#message-input')!.dispatchEvent(event); });
    await vi.waitFor(() => expect(setAttachments).toHaveBeenCalledWith([{ name: 'Screenshot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw==' }]));
  });

  it('leaves ordinary clipboard text to the textarea', () => {
    const setAttachments = vi.fn();
    act(() => {
      root.render(React.createElement(Composer, {
        settings, selection: { providerId: 'test', model: 'model', mode: 'build' }, onSelection: () => {},
        onSend: async () => true, onCancel: () => {}, running: false, disabled: false, workspace: '/tmp',
        text: '', setText: () => {}, attachments: [], setAttachments, onSettings: () => {},
      } as any));
    });

    const event = new Event('paste', { bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [] } });
    const input = container.querySelector<HTMLTextAreaElement>('#message-input')!;
    input.dispatchEvent(event);
    expect(setAttachments).not.toHaveBeenCalled();
  });
});
