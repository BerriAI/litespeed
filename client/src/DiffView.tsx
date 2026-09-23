import { useMemo, useState } from 'react';
import { MessageSquarePlus, WrapText } from 'lucide-react';
import type { FileChange } from '../../shared/types';
import type { ReviewComment } from '../../shared/git-review';
import { highlightedLines } from './syntax';

import { diffRows, type Row } from './diff-model';
export function DiffView({ change, onComment, selected }: { change: FileChange; onComment?: (value: Omit<ReviewComment, 'text'>) => void; selected?: Pick<ReviewComment, 'side' | 'line'> }) {
  const [full, setFull] = useState(false), [wrap, setWrap] = useState(false);
  const rows = useMemo(() => diffRows(change), [change.before, change.after]);
  const [expanded, setExpanded] = useState<number[]>([]);
  const before = useMemo(() => rows ? highlightedLines(change.before || '', change.path) : [], [change.before, change.path, rows]);
  const after = useMemo(() => rows ? highlightedLines(change.after || '', change.path) : [], [change.after, change.path, rows]);
  const visible = useMemo(() => {
    if (!rows) return [];
    const shown = new Set<number>();
    rows.forEach((row, i) => { if (row.kind !== 'context') for (let j = Math.max(0, i - 3); j <= Math.min(rows.length - 1, i + 3); j++) shown.add(j); });
    if (!shown.size) for (let i = 0; i < Math.min(rows.length, 6); i++) shown.add(i);
    const result: ({ row: Row; index: number } | { start: number; end: number })[] = [];
    let start = -1;
    for (let i = 0; i < Math.min(rows.length, 10_000); i++) {
      if (full || shown.has(i)) { if (start >= 0) { result.push({ start, end: i - 1 }); start = -1; } result.push({ row: rows[i], index: i }); }
      else if (start < 0) start = i;
    }
    if (start >= 0) result.push({ start, end: Math.min(rows.length, 10_000) - 1 });
    return result.flatMap(item => 'start' in item && expanded.includes(item.start) ? rows.slice(item.start, item.end + 1).map((row, i) => ({ row, index: i + item.start })) : [item]);
  }, [rows, full, expanded]);
  if (!rows) return <p className="review-notice">This comparison is too large to render quickly. Open the files to review them.</p>;
  return <div className={`review-diff ${wrap ? 'wrap-lines' : ''}`}>
    <div className="diff-options"><button aria-pressed={full} onClick={() => setFull(value => !value)}>{full ? 'Show changes only' : 'Show full file'}</button><button className="icon-button" title="Wrap lines" aria-label="Wrap diff lines" aria-pressed={wrap} onClick={() => setWrap(value => !value)}><WrapText size={14} /></button></div>
    <div className="diff-view" aria-label={`Changes to ${change.path}`} tabIndex={0}>
      {visible.map(item => {
        if ('start' in item) return <button className="diff-context-gap" key={`gap-${item.start}`} onClick={() => setExpanded(current => [...current, item.start])}>Show {item.end - item.start + 1} unchanged lines</button>;
        const { row, index } = item, side = row.kind === 'removed' ? 'before' : 'after', line = (side === 'before' ? row.before : row.after)!;
        const html = (side === 'before' ? before : after)[line - 1] || '&nbsp;';
        return <div key={index} className={`diff-line ${row.kind} ${selected?.side === side && selected.line === line ? 'commented-line' : ''}`}>
          {onComment && <button className="diff-comment" data-review-line={index} tabIndex={visible.find(item => 'row' in item) === item ? 0 : -1} aria-label={`Comment on ${side === 'before' ? 'old' : 'new'} line ${line}`} title="Add feedback" onClick={() => onComment({ path: change.path, side, line })} onKeyDown={event => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            const buttons = [...event.currentTarget.closest('.diff-view')!.querySelectorAll<HTMLButtonElement>('[data-review-line]')], current = buttons.indexOf(event.currentTarget);
            event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)))]?.focus();
          }}><MessageSquarePlus size={12} /></button>}
          <span className="line-number" aria-hidden="true">{row.before}</span><span className="line-number" aria-hidden="true">{row.after}</span><span className="diff-sign" aria-hidden="true">{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}</span><code dangerouslySetInnerHTML={{ __html: html }} />
        </div>;
      })}
      {!rows.length && <p className="review-notice">{change.before === null ? 'Empty file added.' : change.after === null ? 'Empty file deleted.' : 'No text changes.'}</p>}
      {rows.length > 10_000 && <p className="review-notice">Showing the first 10,000 lines.</p>}
      {(change.before?.length && !change.before.endsWith('\n') || change.after?.length && !change.after.endsWith('\n')) ? <p className="diff-newline-note">No newline at end of {change.after?.length && !change.after.endsWith('\n') ? 'new' : 'original'} file</p> : null}
    </div>
  </div>;
}
