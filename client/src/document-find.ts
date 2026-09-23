export type DocumentMatch = { line: number; start: number; end: number; index: number };
export const DOCUMENT_MATCH_LIMIT = 1_000;

/** Literal matching keeps file search predictable, including punctuation and
 * Unicode. Positions use the same UTF-16 offsets as browser text nodes. */
export function findInDocument(content: string, query: string, matchCase = false): { matches: DocumentMatch[]; more: boolean } {
  if (!query || query.length > 200) return { matches: [], more: false };
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  const matches: DocumentMatch[] = [];
  for (const [line, text] of content.split('\n').entries()) {
    for (const match of text.matchAll(expression)) {
      if (matches.length === DOCUMENT_MATCH_LIMIT) return { matches, more: true };
      matches.push({ line: line + 1, start: match.index!, end: match.index! + match[0].length, index: matches.length });
    }
  }
  return { matches, more: false };
}

/** Input is escaped, syntax-highlighted HTML produced by highlightedLines.
 * Work on text nodes so a match may span tokens without flattening syntax. */
export function markDocumentLine(html: string, matches: readonly DocumentMatch[], activeIndex?: number): string {
  if (!matches.length) return html;
  const template = document.createElement('template'); template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let offset = 0;
  for (const node of nodes) {
    const value = node.data, end = offset + value.length, parts = matches.filter(match => match.start < end && match.end > offset);
    if (parts.length) {
      const fragment = document.createDocumentFragment(); let cursor = 0;
      for (const match of parts) {
        const start = Math.max(0, match.start - offset), stop = Math.min(value.length, match.end - offset);
        fragment.append(value.slice(cursor, start));
        const mark = document.createElement('mark'); mark.dataset.fileMatch = String(match.index); if (match.index === activeIndex) mark.className = 'active-match'; mark.textContent = value.slice(start, stop); fragment.append(mark); cursor = stop;
      }
      fragment.append(value.slice(cursor)); node.replaceWith(fragment);
    }
    offset = end;
  }
  return template.innerHTML;
}
