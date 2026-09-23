import { RotateCcw } from 'lucide-react';
import type { BrowserInspectedElement, BrowserStyleChanges } from '../../shared/browser-inspector';

function numeric(value: string): string { const number = Number.parseFloat(value); return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : 'Auto'; }
function hex(value: string): string | undefined {
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  return rgb && (!rgb[4] || rgb[4] === '1') ? '#' + rgb.slice(1, 4).map(value => Number(value).toString(16).padStart(2, '0')).join('') : undefined;
}
export function BrowserAdjustments({ element, changes, captured, busy, onChange, onPreview, onReset, onRevert }: {
  element: BrowserInspectedElement; changes: BrowserStyleChanges; captured: BrowserStyleChanges; busy: boolean;
  onChange: (changes: BrowserStyleChanges) => void; onPreview: () => void; onReset: () => void; onRevert: () => void;
}) {
  const changed = [...new Set([...Object.keys(changes), ...Object.keys(captured)])].some(key => changes[key as keyof BrowserStyleChanges] !== captured[key as keyof BrowserStyleChanges]);
  function update(key: keyof BrowserStyleChanges, value: string | number | undefined) {
    const next = { ...changes, [key]: value }; if (value === undefined) delete next[key]; onChange(next);
  }
  function number(key: 'fontSize' | 'lineHeight' | 'padding' | 'margin' | 'borderRadius', label: string, min: number, max: number, step = 1) {
    const placeholder = key === 'lineHeight' ? (Number.parseFloat(element.styles.lineHeight) / Number.parseFloat(element.styles.fontSize)).toFixed(2).replace('NaN', 'Auto') : /\s/.test(element.styles[key]) ? 'Mixed' : numeric(element.styles[key]);
    return <label><span>{label}</span><div className="browser-adjust-number"><input type="number" aria-label={label} min={min} max={max} step={step} value={changes[key] ?? ''} placeholder={placeholder} onChange={event => update(key, event.target.value === '' ? undefined : Number(event.target.value))} /><span>{key === 'lineHeight' ? '×' : 'px'}</span></div></label>;
  }
  return <div className="browser-adjustments" role="group" aria-label="Element adjustments">
    <fieldset disabled={busy}>
      {element.editableText && <label className="browser-adjust-text"><span>Text</span><input aria-label="Element text" maxLength={2000} value={changes.text ?? element.text} onChange={event => update('text', event.target.value === element.text ? undefined : event.target.value)} /></label>}
      <div className="browser-adjust-grid">
        <label><span>Font</span><select aria-label="Element font" value={changes.fontFamily ?? ''} onChange={event => update('fontFamily', event.target.value || undefined)}><option value="">{element.styles.fontFamily.split(',')[0].replace(/["\']/g, '')}</option><option value="system-ui">System</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="monospace">Monospace</option></select></label>
        {number('fontSize', 'Font size', 6, 200)}
        <label><span>Weight</span><select aria-label="Font weight" value={changes.fontWeight ?? ''} onChange={event => update('fontWeight', event.target.value ? Number(event.target.value) : undefined)}><option value="">Original · {element.styles.fontWeight}</option>{[100, 200, 300, 400, 500, 600, 700, 800, 900].map(weight => <option key={weight} value={weight}>{weight}</option>)}</select></label>
        {number('lineHeight', 'Line height', 0.7, 4, 0.05)}
        {(['color', 'backgroundColor'] as const).map(key => <label key={key}><span>{key === 'color' ? 'Text color' : 'Background'}</span><div className="browser-adjust-color"><input type="color" aria-label={key === 'color' ? 'Text color' : 'Background color'} value={hex(changes[key] ?? '') || changes[key]?.match(/^#[0-9a-f]{6}$/i)?.[0] || hex(element.styles[key]) || '#ffffff'} onChange={event => update(key, event.target.value)} /><span>{changes[key] || hex(element.styles[key]) || 'Transparent'}</span><button type="button" aria-label={`Restore ${key === 'color' ? 'text color' : 'background'}`} title="Restore original" disabled={changes[key] === undefined} onClick={() => update(key, undefined)}><RotateCcw size={11} /></button></div></label>)}
      </div>
      <div className="browser-adjust-grid spacing">{number('padding', 'Padding', 0, 160)}{number('margin', 'Margin', 0, 160)}{number('borderRadius', 'Radius', 0, 200)}</div>
    </fieldset>
    <div className="browser-adjust-actions"><button type="button" disabled={busy || !Object.keys(captured).length && !Object.keys(changes).length} onClick={onReset}><RotateCcw size={12} />Reset</button><span>{changed && <button type="button" disabled={busy} onClick={onRevert}>Undo edits</button>}<button type="button" className="button secondary" disabled={busy || !changed} onClick={onPreview}>{busy ? 'Capturing…' : 'Preview changes'}</button></span></div>
    <p>Preview only. Your comment asks Litespeed to make the change.</p>
  </div>;
}
