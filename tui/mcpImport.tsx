/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react';
import { MCP_IMPORT_LIMITS, type McpImportCandidate, type McpImportPlan, type McpImportResult } from '../shared/mcp-import.js';
import { TerminalController } from './controller.js';
import { Menu, type MenuItem } from './ui.js';

type Discovery = { candidates: McpImportCandidate[]; issues?: string[] };
type Revision = { configRevision: string };

export function McpImporter({ controller, workspace, onClose, onImported }: {
  controller: TerminalController;
  workspace: string;
  onClose: () => void;
  onImported: (result: McpImportResult) => void;
}) {
  const [items, setItems] = useState<McpImportCandidate[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<McpImportPlan | null>(null);
  const [revision, setRevision] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    setBusy(true); setError(''); setItems([]); setIssues([]);
    setSelected([]); setPlan(null); setRevision(''); setLoaded(false);
    void controller.client.api<Discovery>(`/mcp/import/discover?workspace=${encodeURIComponent(workspace)}`)
      .then(result => { if (live) { setItems(result.candidates); setIssues(result.issues ?? []); } })
      .catch(cause => { if (live) setError((cause as Error).message); })
      .finally(() => { if (live) { setLoaded(true); setBusy(false); } });
    return () => { live = false; };
  }, [controller, workspace, refresh]);

  const toggle = (id: string) => setSelected(value => {
    if (value.includes(id)) return value.filter(item => item !== id);
    return value.length >= MCP_IMPORT_LIMITS.selected ? value : [...value, id];
  });
  const review = async () => {
    if (busy || !selected.length) return;
    setBusy(true); setError('');
    try {
      // Bind a revision from before the reviewed plan; never silently update it
      // at confirmation, which could otherwise accept unseen config changes.
      const status = await controller.client.api<Revision>('/mcp');
      const next = await controller.client.api<McpImportPlan>('/mcp/import/plan', { workspace, ids: selected });
      setRevision(status.configRevision); setPlan(next);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (busy || !plan || !revision) return;
    setBusy(true); setError('');
    try {
      let result: McpImportResult | undefined;
      const ok = await controller.action('Importing MCP servers', async () => {
        result = await controller.client.api<McpImportResult>('/mcp/import/apply', {
          workspace, ids: selected, sourceHash: plan.sourceHash, expectedMcpConfigRevision: revision,
        });
      });
      if (ok && result) onImported(result);
      else setError(controller.getState().notice || 'Import was not completed.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };

  if (plan) {
    const choices: MenuItem[] = plan.candidates.map(item => ({
      id: item.id, label: `${item.name} · ${item.compatible && !item.conflict ? 'disabled import' : 'skipped'}`,
      description: item.reason, disabled: true, action() {},
    }));
    // Put the credential confirmation in a menu row too: terminal footer height
    // is bounded and must not be the only place this warning is visible.
    choices.push({
      id: 'credentials', label: 'Copies configured environment values, possibly API keys',
      description: 'Global Litespeed settings · disabled and disconnected · no OAuth logins transferred',
      disabled: true, action() {},
    }, {
      id: 'confirm', label: 'Confirm import',
      disabled: busy || !revision || !plan.candidates.some(item => item.compatible && !item.conflict),
      action: () => { void confirm(); },
    }, {
      id: 'back', label: 'Back', disabled: busy, action: () => { setPlan(null); setError(''); },
    });
    return <Menu title="Review MCP import" onClose={close} footer={error || plan.warnings.join(' · ')} items={choices} />;
  }

  const choices: MenuItem[] = items.map(item => ({
    id: item.id, label: `${selected.includes(item.id) ? '☑' : '☐'} ${item.name}`,
    description: `${item.source} ${item.scope} · ${item.transport}${item.conflict ? ' · already configured' : ''}${item.reason ? ` · ${item.reason}` : ''}`,
    disabled: busy || !item.compatible || item.conflict || (!selected.includes(item.id) && selected.length >= MCP_IMPORT_LIMITS.selected),
    action: () => toggle(item.id),
  }));
  choices.push({
    id: 'refresh', label: error ? 'Retry discovery' : 'Refresh discovery', separatorBefore: true,
    disabled: busy, action: () => setRefresh(value => value + 1),
  }, {
    id: 'review', label: 'Review selected servers', disabled: busy || !selected.length,
    action: () => { void review(); },
  });
  const hint = busy && !loaded ? 'Scanning fixed Claude Code and Codex configuration locations…'
    : loaded && !items.length ? 'No importable MCP configurations found.'
      : 'Select up to 30 compatible servers. Values are never displayed.';
  return <Menu title="Import Claude/Codex MCP servers" onClose={close} footer={error || issues.join(' · ') || hint} items={choices} />;
}
