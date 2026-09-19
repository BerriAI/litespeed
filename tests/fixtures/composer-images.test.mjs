import { afterEach, describe, expect, it } from 'bun:test';
import { TextareaRenderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { ComposerImages, removeDraftAttachment } from '../../tui/composerImages.ts';

const image = { name: 'clipboard-image.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
const cleanup = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
async function composer(draft = { text: '', attachments: [] }) {
  const { renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 });
  cleanup.push(() => renderer.destroy());
  const editor = new TextareaRenderable(renderer, { id: 'composer', width: 76, height: 8, initialValue: draft.text });
  renderer.root.add(editor);
  editor.focus(); await renderOnce();
  const images = new ComposerImages(editor);
  return { editor, images, draft: images.load(draft) };
}

describe('inline image attachments in the native editor', () => {
  it('inserts at the cursor and removes/restores the actual image with backspace and undo', async () => {
    const { editor, images } = await composer({ text: 'before  after', attachments: [] });
    editor.cursorOffset = 7;
    let draft = images.insert({ text: editor.plainText, attachments: [] }, image);
    expect(draft.text).toBe('before [Image-1] after');
    expect(draft.attachments[0]).toMatchObject({ name: 'Image-1.png', dataUrl: image.dataUrl });
    editor.deleteCharBackward(); draft = images.read(draft);
    expect(draft.text).toBe('before  after'); expect(draft.attachments).toEqual([]);
    editor.undo(); draft = images.read(draft);
    expect(draft.text).toBe('before [Image-1] after'); expect(draft.attachments[0].dataUrl).toBe(image.dataUrl);
    editor.redo(); draft = images.read(draft);
    expect(draft.text).toBe('before  after'); expect(draft.attachments).toEqual([]);
  });

  it('keeps multiple images and their payloads distinct while editing surrounding text', async () => {
    const { editor, images, draft: empty } = await composer();
    let draft = images.insert(empty, image);
    editor.insertText(' versus '); draft = images.read(draft);
    draft = images.insert(draft, { ...image, dataUrl: image.dataUrl + 'second' });
    editor.gotoBufferHome(); editor.insertText('Compare '); draft = images.read(draft);
    expect(draft.text).toBe('Compare [Image-1] versus [Image-2]');
    const next = removeDraftAttachment(draft, 0);
    images.load(next);
    expect(editor.plainText).toBe('Compare  versus [Image-2]');
    expect(next.attachments).toHaveLength(1); expect(next.attachments[0].dataUrl).toContain('second');
    editor.gotoBufferEnd(); editor.moveCursorLeft(); editor.deleteChar();
    expect(images.read(next).attachments).toEqual([]);
  });

  it('restores ranges around Unicode after a draft restart and keeps ordinary file attachments', async () => {
    const first = await composer({ text: '你好 👩🏽‍💻\nLook at ', attachments: [{ name: 'notes.txt', content: 'keep' }] });
    first.editor.gotoBufferEnd(); let draft = first.images.insert(first.draft, image);
    first.editor.insertText(' please'); draft = first.images.read(draft);
    const restored = await composer(JSON.parse(JSON.stringify(draft)));
    restored.editor.gotoBufferEnd();
    for (let i = 0; i < ' please'.length; i++) restored.editor.deleteCharBackward();
    restored.editor.deleteCharBackward();
    const removed = restored.images.read(restored.draft);
    expect(removed.text).toBe('你好 👩🏽‍💻\nLook at ');
    expect(removed.attachments).toEqual([{ name: 'notes.txt', content: 'keep' }]);
  });

  it('restores queued image labels without duplicating the label or payload', async () => {
    const queued = { text: 'Check [Image-1]', attachments: [{ ...image, name: 'Image-1.png' }] };
    const { editor, images, draft } = await composer(queued);
    expect(draft.text).toBe(queued.text); expect(draft.attachments).toHaveLength(1);
    editor.selectAll(); editor.deleteCharBackward();
    expect(images.read(draft)).toEqual({ text: '', attachments: [] });
  });
  it('renumbers colliding labels when multiple queued messages return to one draft', async () => {
    const queued = { text: 'First [Image-1]\nSecond [Image-1]', attachments: [{ ...image, name: 'Image-1.png' }, { ...image, name: 'Image-1.png', dataUrl: image.dataUrl + 'second' }] };
    const { editor, images, draft } = await composer(queued);
    expect(draft.text).toBe('First [Image-1]\nSecond [Image-2]');
    expect(draft.attachments.map(item => item.name)).toEqual(['Image-1.png', 'Image-2.png']);
    editor.gotoBufferEnd(); editor.deleteCharBackward();
    const removed = images.read(draft);
    expect(removed.text).toBe('First [Image-1]\nSecond ');
    expect(removed.attachments).toEqual([queued.attachments[0]]);
    editor.undo();
    expect(images.read(removed).attachments[1].dataUrl).toBe(queued.attachments[1].dataUrl);
  });
  it('treats word deletion and partial selection as removal of the whole image', async () => {
    const { editor, images, draft: empty } = await composer({ text: 'See ', attachments: [] });
    editor.gotoBufferEnd(); let draft = images.insert(empty, image);
    editor.deleteWordBackward(); draft = images.read(draft);
    expect(draft).toEqual({ text: 'See ', attachments: [] });
    editor.undo(); draft = images.read(draft);
    expect(draft.attachments).toHaveLength(1);
    editor.editorView.setSelection(6, 9); editor.editorView.deleteSelectedText();
    expect(images.read(draft)).toEqual({ text: 'See ', attachments: [] });
  });
});
