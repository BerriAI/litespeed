// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { conversationView, forgetConversationView, readConversationView, saveConversationView } from '../client/src/conversation-state';
const key = 'litespeed:conversation-views:v1';
beforeEach(() => { const entries = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } }); });
afterEach(() => vi.unstubAllGlobals());
it('validates stored reading state and excludes message content', () => {
  expect(conversationView({ following: false, top: 800, anchor: { message: 'id', block: 3, offset: 20 }, prompts: ['id'], content: 'private message' })).toEqual({ following: false, top: 800, anchor: { message: 'id', block: 3, offset: 20 }, prompts: ['id'] });
  expect(conversationView({ following: 'false', top: Infinity, anchor: { message: 'id', offset: NaN }, prompts: ['ok', null, 3, 'ok'], steps: {} })).toEqual({ prompts: ['ok'] });
  expect(conversationView({ top: -3, anchor: { message: 'id', block: 1.2, offset: -3000 } })).toEqual({ top: 0, anchor: { message: 'id', offset: -1000 } });
});
it('bounds task histories and clears a deleted task despite a later unmount save', () => {
  for (let i = 0; i < 85; i++) saveConversationView(String(i), { following: false, top: i });
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(80); expect(readConversationView('0')).toEqual({}); expect(readConversationView('84').top).toBe(84);
  forgetConversationView('84'); saveConversationView('84', { top: 100 }); expect(readConversationView('84')).toEqual({});
});
it('tolerates malformed or unavailable storage without losing other valid task entries', () => {
  localStorage.setItem(key, '[null,["a",{"top":20}],12,[3,{}]]'); expect(readConversationView('a')).toEqual({ top: 20 });
  saveConversationView('b', { top: 50 }); expect(readConversationView('a')).toEqual({ top: 20 });
  localStorage.setItem(key, '{'); expect(readConversationView('b')).toEqual({}); expect(() => saveConversationView('b', { top: 1 })).not.toThrow();
  vi.stubGlobal('localStorage', { getItem() { throw new Error('Unavailable'); }, setItem() { throw new Error('Full'); } }); expect(readConversationView('b')).toEqual({}); expect(() => saveConversationView('b', {})).not.toThrow();
});
