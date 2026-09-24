// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conversation } from '../client/src/Conversation';
import { applyEvent } from '../shared/events';
import type { Message, SessionDetail } from '../shared/types';

const message = (id: string, patch: Partial<Message> = {}): Message => ({ id, sessionId: 'session', role: 'assistant', content: '', createdAt: 1, ...patch });
let root: Root, detail: SessionDetail, eventId: number;
const render = async () => { await act(async () => root.render(createElement(Conversation, {
  detail, connection: 'connected', busy: false, onDecide() {}, onFork() {}, renderQuestion: () => null,
}))); };
async function delta(type: 'delta' | 'reasoning', text: string, id = 'reply') {
  detail = applyEvent(detail, { id: ++eventId, sessionId: 'session', type, data: { messageId: id, delta: text } });
  await render();
}
const blocks = () => [...document.querySelectorAll('.message-body > .markdown, .message-body > .work-log')].map(node =>
  node.classList.contains('work-log') ? [...node.querySelectorAll('.thinking-inline, .tool-name')].map(child => child.textContent).join(' | ') : node.textContent);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')!); eventId = 0;
  detail = { session: { id: 'session', title: 'Response order', workspace: '/workspace', model: 'model', providerId: 'fixture', mode: 'build', permissionMode: 'ask', status: 'running', archived: false, createdAt: 1, updatedAt: 1 }, messages: [message('reply')], todos: [], permissions: [] };
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe('thinking follows the response chronology', () => {
  it('keeps the live thinking row in place when text starts, completes, and reloads', async () => {
    await delta('reasoning', 'Considering the request.');
    const thinking = document.querySelector('details.work-log') as HTMLDetailsElement;
    expect(thinking.open).toBe(true); expect(thinking.querySelector('summary')!.textContent).toBe('Thinking');
    await delta('delta', 'Here is the answer.');
    expect(blocks()).toEqual(['Considering the request.', 'Here is the answer.']);
    expect(document.querySelector('details.work-log')).toBe(thinking);
    expect(thinking.open).toBe(false); expect(thinking.querySelector('summary')!.textContent).toBe('Thought process');
    detail = JSON.parse(JSON.stringify({ ...detail, session: { ...detail.session, status: 'idle' } }));
    await act(async () => root.unmount()); root = createRoot(document.getElementById('root')!); await render();
    expect(blocks()).toEqual(['Considering the request.', 'Here is the answer.']);
    expect(document.querySelector('.work-log.active')).toBeNull();
  });

  it('does not hoist later thinking over already streamed text or merge separate thinking periods', async () => {
    await delta('delta', 'First, an observation.');
    expect(document.querySelector('.work-log')).toBeNull();
    await delta('reasoning', 'Checking that observation.');
    expect(blocks()).toEqual(['First, an observation.', 'Checking that observation.']);
    expect(document.querySelector('.work-log.active summary')!.textContent).toBe('Thinking');
    await delta('delta', 'Now a conclusion.');
    await delta('reasoning', 'One more check.');
    await delta('delta', 'The final result.');
    const expected = ['First, an observation.', 'Checking that observation.', 'Now a conclusion.', 'One more check.', 'The final result.'];
    expect(blocks()).toEqual(expected);
    // Expanding an earlier thought does not expand the later one.
    await act(async () => (document.querySelector('.work-log summary') as HTMLElement).click());
    expect([...document.querySelectorAll<HTMLDetailsElement>('.work-log')].map(node => node.open)).toEqual([true, false]);
    const lastEvent = { id: eventId, sessionId: 'session', type: 'delta' as const, data: { messageId: 'reply', delta: 'The final result.' } };
    detail = applyEvent(detail, lastEvent); await render(); expect(blocks()).toEqual(expected);
    detail = JSON.parse(JSON.stringify(detail)); await render(); expect(blocks()).toEqual(expected);
  });

  it('keeps later provider-round thinking after earlier prose and tools, including legacy transcripts', async () => {
    detail.session.status = 'idle';
    detail.messages = [
      message('intro', { content: 'I will inspect the project.', toolCalls: [{ id: 'read', name: 'read_file', args: { path: 'README.md' }, status: 'completed' }] }),
      message('follow-up', { reasoning: 'Checking what the file means.' }),
      message('final', { reasoning: 'Preparing the result.', content: 'Here is what I found.' }),
    ];
    await render();
    expect(blocks()).toEqual(['I will inspect the project.', 'Read file | Checking what the file means.', 'Preparing the result.', 'Here is what I found.']);
    expect(document.querySelectorAll('.thinking-inline')).toHaveLength(2);
    expect(document.querySelectorAll('.tool-card')).toHaveLength(1);
  });

  it('preserves plain answers and user text without inventing thinking rows', async () => {
    detail.messages = [message('user', { role: 'user', content: 'What can you do?' }), message('reply', { content: 'I can help with your project.' })];
    await render();
    expect(document.querySelector('.work-log')).toBeNull();
    expect(document.querySelector('.user-message')!.textContent).toContain('What can you do?');
    expect(blocks()).toEqual(['I can help with your project.']);
  });
});
