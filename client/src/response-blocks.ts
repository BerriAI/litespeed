import { messageParts } from '../../shared/message-parts';
import type { Message } from '../../shared/types';
import { withoutVerificationNotice } from '../../shared/verification';

type ResponseBlock = { kind: 'text'; key: string; content: string } | { kind: 'work'; key: string; messages: Message[] };

/** Collapse adjacent activity, but never move it across prose. Tool execution
 * follows the provider message; its thinking can occur on either side of text. */
export function responseBlocks(steps: Message[]): ResponseBlock[] {
  const blocks: ResponseBlock[] = [];
  const work = (message: Message, key: string, reasoning?: string, tools = false) => {
    let block = blocks.at(-1);
    if (block?.kind !== 'work') { block = { kind: 'work', key, messages: [] }; blocks.push(block); }
    const previous = block.messages.at(-1);
    if (previous?.id === message.id) {
      if (reasoning) previous.reasoning = (previous.reasoning ?? '') + reasoning;
      if (tools) previous.toolCalls = message.toolCalls;
    } else block.messages.push({ ...message, content: '', reasoning, toolCalls: tools ? message.toolCalls : undefined });
  };
  for (const message of steps) {
    const visibleContent = withoutVerificationNotice(message.content, message.receipts);
    for (const part of messageParts(message)) {
      const key = `${message.id}:${part.type}:${part.start}`;
      if (part.type === 'reasoning') work(message, key, part.text);
      else {
        const content = visibleContent.slice(part.start, part.end);
        if (content) blocks.push({ kind: 'text', key, content });
      }
    }
    if (message.toolCalls?.length) work(message, `${message.id}:tools`, undefined, true);
  }
  return blocks;
}
