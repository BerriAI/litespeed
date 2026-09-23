export type ConversationView = { following?: boolean; top?: number; anchor?: { message: string; block?: number; offset: number }; steps?: string[]; prompts?: string[] };
const key = 'litespeed:conversation-views:v1', forgotten = new Set<string>();
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function conversationView(value: unknown): ConversationView {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, any>, result: ConversationView = {};
  if (typeof input.following === 'boolean') result.following = input.following;
  if (finite(input.top)) result.top = Math.max(0, Math.min(10_000_000, input.top));
  if (input.anchor && id(input.anchor.message) && finite(input.anchor.offset)) {
    result.anchor = { message: input.anchor.message, offset: Math.max(-1000, Math.min(100_000, input.anchor.offset)) };
    if (finite(input.anchor.block) && Number.isInteger(input.anchor.block) && input.anchor.block >= 0 && input.anchor.block < 10_000) result.anchor.block = input.anchor.block;
  }
  for (const field of ['steps', 'prompts'] as const) if (Array.isArray(input[field])) result[field] = [...new Set<string>(input[field].filter(id))].slice(-100);
  return result;
}
function entries(): [string, ConversationView][] {
  try { const data = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(data) ? data.filter(value => Array.isArray(value) && id(value[0])).slice(-80).map(([id, value]) => [id, conversationView(value)]) : []; } catch { return []; }
}
export function readConversationView(sessionId: string): ConversationView { return entries().find(([id]) => id === sessionId)?.[1] ?? {}; }
export function saveConversationView(sessionId: string, value: ConversationView): void {
  if (forgotten.has(sessionId)) return;
  try { localStorage.setItem(key, JSON.stringify([...entries().filter(([id]) => id !== sessionId), [sessionId, conversationView(value)]].slice(-80))); } catch { /* Optional reading preferences must not prevent conversation use. */ }
}
export function forgetConversationView(sessionId: string): void {
  forgotten.add(sessionId); if (forgotten.size > 100) forgotten.delete(forgotten.values().next().value!);
  try { localStorage.setItem(key, JSON.stringify(entries().filter(([id]) => id !== sessionId))); } catch { /* Storage can be unavailable. */ }
}
