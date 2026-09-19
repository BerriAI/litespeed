import { useEffect, useState } from 'react';
import { MCP_IMPORT_LIMITS, type McpImportCandidate, type McpImportPlan, type McpImportResult } from '../../shared/mcp-import';
import { api, errorMessage, post } from './api';
import { Modal } from './ui';

type Discovery = { candidates: McpImportCandidate[]; issues?: string[] };
type Revision = { configRevision: string };

export function McpImporter({ workspace, onClose, onImported }: {
  workspace: string;
  onClose: () => void;
  onImported: (result: McpImportResult) => void;
}) {
  const [items, setItems] = useState<McpImportCandidate[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<McpImportPlan | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    setBusy(true); setError(''); setPlan(null); setReviewedRevision('');
    setSelected([]); setItems([]); setIssues([]); setLoaded(false);
    void api<Discovery>(`/mcp/import/discover?${new URLSearchParams({ workspace })}`)
      .then(value => { if (live) { setItems(value.candidates); setIssues(value.issues ?? []); } })
      .catch(cause => { if (live) setError(errorMessage(cause)); })
      .finally(() => { if (live) { setLoaded(true); setBusy(false); } });
    return () => { live = false; };
  }, [workspace, refresh]);

  const toggle = (id: string) => setSelected(current => {
    if (current.includes(id)) return current.filter(value => value !== id);
    return current.length >= MCP_IMPORT_LIMITS.selected ? current : [...current, id];
  });
  const preview = async () => {
    setBusy(true); setError('');
    try {
      const revision = await api<Revision>('/mcp');
      const next = await post<McpImportPlan>('/mcp/import/plan', { workspace, ids: selected });
      setReviewedRevision(revision.configRevision); setPlan(next);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const apply = async (connect=false) => {
    if (!plan || !reviewedRevision) return;
    setBusy(true); setError('');
    try {
      const result = await post<McpImportResult>('/mcp/import/apply', { workspace, ids: selected, sourceHash: plan.sourceHash, expectedMcpConfigRevision: reviewedRevision, ...(connect?{connect:true}:{}) });
      onImported(result);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };

  return <Modal title="Import Claude/Codex MCP servers" onClose={close}>
    <div className="form-stack">
      <p>Choose configurations to copy into <strong>global Litespeed settings</strong>. Review the selected commands and endpoints, then import disabled or import and connect.</p>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      {issues.length > 0 && <div className="inline-alert" role="status">{issues.join(' · ')}</div>}
      {!plan && <>
        {busy && !loaded && <p role="status">Scanning fixed Claude Code and Codex configuration locations…</p>}
        {loaded && items.length === 0 && <p className="field-hint">No importable MCP configurations found.</p>}
        {items.map(item => <label key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || !item.compatible || item.conflict || (!selected.includes(item.id) && selected.length >= MCP_IMPORT_LIMITS.selected)} onChange={() => toggle(item.id)} />
          <strong>{item.name}</strong> · {item.source} {item.scope} · {item.transport}
          {item.envKeys.length ? ` · ${item.envKeys.length} environment values` : ''}
          {item.conflict ? ' · already configured' : ''}{item.reason ? ` · ${item.reason}` : ''}
        </label>)}
        <div className="form-actions"><button className="button secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{error ? 'Retry discovery' : 'Refresh discovery'}</button><button className="button primary" disabled={busy || !selected.length} onClick={() => void preview()}>Review selected servers</button></div>
      </>}
      {plan && <>
        {plan.connections?.map(connection=><div key={connection.name}><strong>{connection.name}</strong><pre>{connection.url||[connection.command,...connection.args??[]].join(' ')}</pre><p>Environment keys: {connection.envKeys.join(', ')||'none'}</p></div>)}
        <p>Import and connect runs these executables or contacts these endpoints with the copied credentials.</p>
        <p><strong>{plan.candidates.filter(item => item.compatible && !item.conflict).length} server(s)</strong> will be copied to global settings, disabled and disconnected. Static environment values may include API keys and are copied server-side only on confirmation.</p>
        {plan.warnings.length > 0 && <div className="inline-alert" role="status">{plan.warnings.join(' · ')}</div>}
        <ul>{plan.candidates.map(item => <li key={item.id}>{item.name} — {item.conflict || !item.compatible ? `skipped: ${item.reason ?? 'unavailable'}` : 'disabled import'}</li>)}</ul>
        <p>OAuth caches, headers, environment forwarding, and interpolation are not imported. Choose Sign in for remote servers that require OAuth.</p>
        <div className="form-actions"><button className="button secondary" disabled={busy} onClick={() => { setPlan(null); setError(''); }}>Back</button><button className="button primary" disabled={busy || !reviewedRevision || !plan.candidates.some(item => item.compatible && !item.conflict)} onClick={() => void apply()}>Confirm import</button><button className="button primary" disabled={busy || !reviewedRevision || !plan.connections?.length} onClick={()=>void apply(true)}>Import and connect selected</button></div>
      </>}
    </div>
  </Modal>;
}
