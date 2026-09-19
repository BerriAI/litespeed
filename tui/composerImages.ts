import type { TextareaRenderable } from '@opentui/core';
import type { Attachment } from '../shared/types.js';
import type { Draft, DraftImage } from './controller.js';

interface ImageMark { attachment: Attachment; label: string }
const isImage = (attachment: Attachment) => Boolean(attachment.dataUrl && attachment.mimeType?.startsWith('image/'));

/** Images stay real attachments. Virtual editor ranges make their visible labels
 * move and delete as a unit, including restoring the image when an edit is undone. */
export class ComposerImages {
  private readonly type: number;
  private applied?: Draft;
  private sequence = 0;
  generation = 0;
  updating = false;
  constructor(readonly editor: TextareaRenderable) {
    this.type = editor.extmarks.registerType('composer-image');
    // OpenTUI 0.5's virtual-range left movement lands one cell before the range.
    // Stop on its boundary so the adjacent character remains independently editable.
    const moveLeft = editor.moveCursorLeft.bind(editor);
    editor.moveCursorLeft = options => {
      const mark = !options?.select && !editor.editorView.hasSelection() && editor.extmarks.getAll().find(mark => mark.typeId === this.type && mark.end === editor.cursorOffset);
      const position = mark && editor.editBuffer.offsetToPosition(mark.start);
      if (!position) return moveLeft(options);
      editor.editBuffer.setCursor(position.row, position.col); editor.requestRender(); return true;
    };
    const deleteRange = editor.editBuffer.deleteRange.bind(editor.editBuffer);
    editor.editBuffer.deleteRange = (startRow, startCol, endRow, endCol) => {
      const range = this.expandDeletion(editor.editBuffer.positionToOffset(startRow, startCol), editor.editBuffer.positionToOffset(endRow, endCol));
      const start = editor.editBuffer.offsetToPosition(range.start), end = editor.editBuffer.offsetToPosition(range.end);
      if (start && end) deleteRange(start.row, start.col, end.row, end.col);
    };
    const deleteSelection = editor.editorView.deleteSelectedText.bind(editor.editorView);
    editor.editorView.deleteSelectedText = () => {
      const selection = editor.editorView.getSelection();
      if (selection) {
        const range = this.expandDeletion(Math.min(selection.start, selection.end), Math.max(selection.start, selection.end));
        editor.editorView.setSelection(range.start, range.end);
      }
      deleteSelection();
    };
  }
  private expandDeletion(start: number, end: number) {
    for (const mark of this.editor.extmarks.getAll()) {
      if (mark.typeId === this.type && mark.start < end && mark.end > start) {
        start = Math.min(start, mark.start); end = Math.max(end, mark.end);
      }
    }
    return { start, end };
  }
  private mark(start: number, end: number, data: ImageMark) {
    this.editor.extmarks.create({ start, end, virtual: true, typeId: this.type, styleId: this.editor.syntaxStyle?.getStyleId('image') ?? undefined, data });
  }
  // Native offsets count terminal cells; persisted ranges use JS string offsets.
  // Ask the editor to translate so wide characters and emoji keep their position.
  private offsetAt(index: number, length: number) {
    let low = 0, high = length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.editor.getTextRange(0, middle).length < index) low = middle + 1; else high = middle;
    }
    return low;
  }
  private label(text: string) {
    let label: string;
    do { label = `[Image-${++this.sequence}]`; } while (text.includes(label));
    return label;
  }
  load(draft: Draft): Draft {
    if (this.applied === draft) return draft;
    this.generation++;
    if (!draft.text && !draft.attachments.length) this.sequence = 0;
    this.updating = true;
    try {
      const cursor = this.editor.cursorOffset;
      let text = draft.text;
      const attachments = [...draft.attachments];
      const images: DraftImage[] = [];
      for (const [index, attachment] of draft.attachments.entries()) {
        if (!isImage(attachment)) continue;
        const saved = draft.inlineImages?.find(image => image.attachmentIndex === index && draft.text.slice(image.start, image.end) === image.label);
        // Queue recall carries the message and attachment name, but no editor metadata.
        const named = /^Image-(\d+)\.png$/.exec(attachment.name);
        let label = saved?.label ?? (named ? `[Image-${named[1]}]` : undefined);
        let start = saved?.start ?? (label ? draft.text.indexOf(label) : -1);
        while (label && start >= 0 && images.some(image => image.start < start + label!.length && image.end > start)) {
          start = draft.text.indexOf(label, start + label.length);
        }
        if (!label || start < 0) {
          label = this.label(text);
          if (text && !/\s$/.test(text)) text += ' ';
          start = text.length;
          text += label;
        }
        images.push({ start, end: start + label.length, attachmentIndex: index, label });
        this.sequence = Math.max(this.sequence, Number(/\d+/.exec(label)?.[0] ?? 0));
      }
      // Separate queued messages can each contain Image-1. Rename repeated labels
      // in place so their payloads still correspond to the surrounding instructions.
      const seen = new Set<string>();
      const replacements = images.filter(image => {
        if (seen.has(image.label)) return true;
        seen.add(image.label); return false;
      }).sort((a, b) => b.start - a.start);
      for (const image of replacements) {
        const label = this.label(text), difference = label.length - (image.end - image.start);
        text = text.slice(0, image.start) + label + text.slice(image.end);
        for (const other of images) if (other.start >= image.end) { other.start += difference; other.end += difference; }
        image.label = label; image.end = image.start + label.length;
        attachments[image.attachmentIndex] = { ...attachments[image.attachmentIndex], name: `${label.slice(1, -1)}.png` };
      }
      this.editor.setText(text);
      this.editor.gotoBufferEnd();
      const length = this.editor.cursorOffset;
      for (const image of images) this.mark(this.offsetAt(image.start, length), this.offsetAt(image.end, length), { attachment: attachments[image.attachmentIndex], label: image.label });
      this.editor.cursorOffset = cursor;
      this.editor.editBuffer.clearHistory();
      const loaded = { text, attachments, ...(images.length ? { inlineImages: images } : {}) };
      return this.read(loaded);
    } finally { this.updating = false; }
  }
  insert(draft: Draft, attachment: Attachment): Draft {
    this.updating = true;
    try {
      const label = this.label(this.editor.plainText);
      this.editor.insertText(label);
      const end = this.editor.cursorOffset;
      this.mark(end - label.length, end, { attachment: { ...attachment, name: `${label.slice(1, -1)}.png` }, label });
      return this.read(draft);
    } finally { this.updating = false; }
  }
  read(draft: Draft): Draft {
    const marked = new Set(draft.inlineImages?.map(image => image.attachmentIndex));
    const attachments = draft.attachments.filter((_, index) => !marked.has(index));
    const images: DraftImage[] = [];
    for (const mark of this.editor.extmarks.getAll().filter(mark => mark.typeId === this.type).sort((a, b) => a.start - b.start)) {
      const data = mark.data as ImageMark;
      if (this.editor.getTextRange(mark.start, mark.end) !== data.label) continue;
      const start = this.editor.getTextRange(0, mark.start).length;
      images.push({ start, end: start + data.label.length, label: data.label, attachmentIndex: attachments.length });
      attachments.push(data.attachment);
    }
    const same = draft.text === this.editor.plainText && draft.attachments.length === attachments.length && attachments.every((item, i) => item === draft.attachments[i]) && JSON.stringify(draft.inlineImages ?? []) === JSON.stringify(images);
    this.applied = same ? draft : { text: this.editor.plainText, attachments, ...(images.length ? { inlineImages: images } : {}) };
    return this.applied;
  }
}

export function removeDraftAttachment(draft: Draft, index: number): Draft {
  const image = draft.inlineImages?.find(image => image.attachmentIndex === index);
  const removed = image ? image.end - image.start : 0;
  return {
    text: image ? draft.text.slice(0, image.start) + draft.text.slice(image.end) : draft.text,
    attachments: draft.attachments.filter((_, i) => i !== index),
    ...(draft.inlineImages ? { inlineImages: draft.inlineImages.filter(item => item !== image).map(item => ({ ...item, start: item.start - (image && item.start >= image.end ? removed : 0), end: item.end - (image && item.end >= image.end ? removed : 0), attachmentIndex: item.attachmentIndex - (item.attachmentIndex > index ? 1 : 0) })) } : {}),
  };
}
