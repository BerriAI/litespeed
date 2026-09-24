import { describe, expect, it } from 'vitest';
import { appendMessageDelta, messageParts } from '../shared/message-parts';
import { responseBlocks } from '../client/src/response-blocks';
import type { Message } from '../shared/types';

const empty = (): Message => ({ id: 'reply', sessionId: 'session', role: 'assistant', content: '', createdAt: 1 });
describe('persisted response order', () => {
  it('coalesces consecutive deltas without mutating earlier snapshots or duplicating stored text', () => {
    const first = appendMessageDelta(empty(), 'text', 'Hello '), snapshot = JSON.stringify(first);
    const second = appendMessageDelta(first, 'text', 'world.');
    const third = appendMessageDelta(second, 'reasoning', 'Checking.');
    const final = appendMessageDelta(third, 'text', ' Done.');
    expect(JSON.stringify(first)).toBe(snapshot);
    expect(final.responseParts).toEqual([{ type: 'text', end: 12 }, { type: 'reasoning', end: 9 }, { type: 'text', end: 18 }]);
    expect(messageParts(final).map(part => part.text)).toEqual(['Hello world.', 'Checking.', ' Done.']);
    expect(appendMessageDelta(final, 'reasoning', '')).toBe(final);
  });

  it('keeps UTF-16 offsets, host-appended text and JSON reloads consistent', () => {
    let msg = appendMessageDelta(empty(), 'text', 'Hi 🙂');
    msg = appendMessageDelta(msg, 'reasoning', 'Think.');
    msg.content += ' Finished.';
    expect(messageParts(JSON.parse(JSON.stringify(msg))).map(part => part.text)).toEqual(['Hi 🙂', 'Think.', ' Finished.']);
  });

  it('falls back safely for old or invalid ordering metadata without dropping text', () => {
    const legacy = { ...empty(), content: 'Answer.', reasoning: 'Thought.' };
    for (const responseParts of [undefined, [{ type: 'text' as const, end: 99 }], [{ type: 'text' as const, end: 5 }, { type: 'text' as const, end: 3 }]]) {
      expect(messageParts({ ...legacy, responseParts }).map(part => part.text)).toEqual(['Thought.', 'Answer.']);
    }
  });

  it('hides only the host verification suffix while retaining the recorded ordering', () => {
    let msg = appendMessageDelta(empty(), 'text', 'Initial finding.');
    msg = appendMessageDelta(msg, 'reasoning', 'Checking the edits.');
    msg = appendMessageDelta(msg, 'text', ' Finished.');
    msg.receipts = { filesChanged: ['file.ts'], checksRun: [], checksFailed: [], filesChangedAfterLastCheck: [] } as any;
    msg.content += '\n\nChanges haven’t been checked: No verification commands were recorded after these changes.';
    const before = JSON.stringify(msg);
    expect(responseBlocks([msg]).map(block => block.kind === 'text' ? block.content : block.messages[0].reasoning)).toEqual(['Initial finding.', 'Checking the edits.', ' Finished.']);
    expect(JSON.stringify(msg)).toBe(before);
  });
});
