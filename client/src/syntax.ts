import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
for (const [name, definition] of Object.entries({ javascript, typescript, json, css, xml, python, bash, markdown, yaml, sql, go, rust })) hljs.registerLanguage(name, definition);
const languages: Record<string, string> = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', css: 'css', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', py: 'python', sh: 'bash', zsh: 'bash', bash: 'bash', md: 'markdown', mdx: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql', go: 'go', rs: 'rust' };
export const languageFor = (path: string) => languages[path.split('.').at(-1)?.toLowerCase() ?? ''] || 'Plain text';
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Balance multiline token spans so each numbered line remains independent. */
export function highlightedLines(content: string, path: string): string[] {
  const language = languageFor(path);
  const html = language === 'Plain text' ? escape(content) : hljs.highlight(content, { language, ignoreIllegals: true }).value;
  const lines: string[] = [], stack: string[] = [];
  let line = '', last = 0;
  for (const match of html.matchAll(/<span\b[^>]*>|<\/span>|\n/g)) {
    line += html.slice(last, match.index);
    if (match[0] === '\n') { lines.push(line + '</span>'.repeat(stack.length)); line = stack.join(''); }
    else { line += match[0]; if (match[0] === '</span>') stack.pop(); else stack.push(match[0]); }
    last = match.index! + match[0].length;
  }
  lines.push(line + html.slice(last));
  return lines;
}
