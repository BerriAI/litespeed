import type { Message, ResponsePart } from './types.js';

type Response = Pick<Message, 'content' | 'reasoning' | 'responseParts'>;
const value = (message: Response, type: ResponsePart['type']) => type === 'text' ? message.content : message.reasoning ?? '';

/** Older transcripts have no within-message ordering. Match their existing
 * TUI presentation, without moving reasoning across message boundaries. */
function legacyParts(message: Response): ResponsePart[] {
  return [
    ...(message.reasoning ? [{ type: 'reasoning' as const, end: message.reasoning.length }] : []),
    ...(message.content ? [{ type: 'text' as const, end: message.content.length }] : []),
  ];
}

/** Store ordering as offsets into the existing fields, not a second transcript.
 * Both the runner and event reducer use this when a provider delta arrives. */
export function appendMessageDelta(message: Message, type: ResponsePart['type'], delta: string): Message {
  if (!delta) return message;
  const parts = [...(message.responseParts ?? legacyParts(message))];
  const end = value(message, type).length + delta.length;
  if (parts.at(-1)?.type === type) parts[parts.length - 1] = { type, end };
  else parts.push({ type, end });
  return { ...message, [type === 'text' ? 'content' : 'reasoning']: value(message, type) + delta, responseParts: parts };
}

/** Present text and thinking where they actually began, including repeated
 * text → thinking → text transitions in one provider message. */
export function messageParts(message: Response): (ResponsePart & { start: number; text: string })[] {
  let parts = message.responseParts;
  const ends = { text: 0, reasoning: 0 };
  if (!Array.isArray(parts) || parts.some(part => {
    if (!part || !['text', 'reasoning'].includes(part.type) || !Number.isSafeInteger(part.end) || part.end <= ends[part.type] || part.end > value(message, part.type).length) return true;
    ends[part.type] = part.end;
    return false;
  })) parts = legacyParts(message);
  else {
    // Host-generated final text can follow the provider stream without a delta.
    parts = [...parts];
    for (const type of ['reasoning', 'text'] as const) if (ends[type] < value(message, type).length) parts.push({ type, end: value(message, type).length });
  }
  const starts = { text: 0, reasoning: 0 };
  return parts.map(part => {
    const start = starts[part.type]; starts[part.type] = part.end;
    return { ...part, start, text: value(message, part.type).slice(start, part.end) };
  });
}
