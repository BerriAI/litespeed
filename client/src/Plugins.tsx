import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Download, Folder, Package, Plus, Search, Settings2, Sparkles, Trash2, Unplug, X } from 'lucide-react';
import type { PluginRegistryEntry, InstallPlan, UninstallResult } from '../../shared/plugins';
import type { ProfileCatalog } from '../../shared/profiles';
import type { McpServerStatus } from '../../shared/mcp';
import { api, errorMessage, post, query } from './api';
import { EmptyState, LiteSpeed, Modal } from './ui';
import { SkillImporter } from './SkillImporter';
import { navigateTabs } from './tab-navigation';

type Category = 'installed' | 'skills' | 'connections';
type Reviewed = { source: string; plan: InstallPlan; planHash: string };
export function Plugins({ workspace, onSkills, onConnections, onChanged }: { workspace: string; onSkills: () => void; onConnections: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<Category>('installed'), [search, setSearch] = useState('');
  const [plugins, setPlugins] = useState<Record<string, PluginRegistryEntry>>({});
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null), [connections, setConnections] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [installing, setInstalling] = useState(false), [importing, setImporting] = useState(false), [source, setSource] = useState('');
  const [reviewed, setReviewed] = useState<Reviewed | null>(null), [removing, setRemoving] = useState<string | null>(null), [busy, setBusy] = useState(false), [dialogError, setDialogError] = useState('');
  const alive = useRef(true), generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current; setLoading(true); setError('');
    try {
      const [installed, skills, mcp] = await Promise.all([api<{ plugins: Record<string, PluginRegistryEntry> }>('/plugins'), api<ProfileCatalog>(`/profiles?${query({ workspace })}`), api<{ servers: McpServerStatus[] }>('/mcp')]);
      if (alive.current && version === generation.current) { setPlugins(installed.plugins); setCatalog(skills); setConnections(mcp.servers); }
    } catch (e) { if (alive.current && version === generation.current) setError(errorMessage(e)); }
    finally { if (alive.current && version === generation.current) setLoading(false); }
  }, [workspace]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; generation.current++; }; }, [load]);
  const match = (...values: (string | undefined)[]) => values.some(value => value?.toLowerCase().includes(search.toLowerCase()));
  const installed = Object.entries(plugins).filter(([, plugin]) => plugin.workspace === workspace).filter(([name, plugin]) => match(name, plugin.description));
  const skills = catalog?.skills.filter(skill => match(skill.name, skill.description)) ?? [];
  const diagnostics = catalog?.diagnostics.filter(issue => !(issue.code === 'missing' && issue.path === '.litespeed/profiles.json')) ?? [];
  const servers = connections.filter(server => match(server.name, ...server.tools.map(tool => tool.remoteName)));
  const startInstall = () => { setInstalling(true); setSource(''); setReviewed(null); setDialogError(''); };
  async function review() {
    if (!source.trim() || busy) return; setBusy(true); setDialogError('');
    try { const value = await post<{ plan: InstallPlan; planHash: string }>('/plugins/plan', { source: source.trim(), workspace }); if (alive.current) setReviewed({ ...value, source: source.trim() }); }
    catch (e) { if (alive.current) setDialogError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function install() {
    if (!reviewed || busy) return; setBusy(true); setDialogError('');
    try {
      const result = await post<{ plan: InstallPlan }>('/plugins/install', { source: reviewed.source, workspace, expectedPlanHash: reviewed.planHash });
      onChanged();
      if (alive.current) { setInstalling(false); setNotice(result.plan.warnings.length ? `Installed ${reviewed.plan.plugin.name}. ${result.plan.warnings.join(' ')}` : `${reviewed.plan.plugin.name} is ready.`); await load(); }
    } catch (e) { if (alive.current) { setDialogError(errorMessage(e)); setReviewed(null); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function remove() {
    if (!removing || busy) return; setBusy(true); setDialogError('');
    try {
      const result = await api<UninstallResult>(`/plugins/${encodeURIComponent(removing)}?${query({ workspace })}`, { method: 'DELETE' });
      onChanged();
      if (alive.current) { setNotice(result.warnings.length ? result.warnings.join(' ') : `${removing} was removed.`); setRemoving(null); await load(); }
    } catch (e) { if (alive.current) setDialogError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="catalog-page" aria-label="Plugins">
    <header className="catalog-heading"><div><h1>Plugins</h1><p>Tools and skills for the way you work.</p></div><button className="button primary" onClick={startInstall}><Plus size={15} />Add plugin</button></header>
    <div className="catalog-controls"><div className="catalog-tabs" role="tablist" aria-label="Plugin categories" onKeyDown={navigateTabs}>{([{ id: 'installed', label: 'Installed' }, { id: 'skills', label: 'Skills' }, { id: 'connections', label: 'Connections' }] as const).map(item => <button key={item.id} role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} onClick={() => { setTab(item.id); setSearch(''); }}>{item.label}</button>)}</div><label className="catalog-search"><Search size={15} /><input aria-label="Search plugins" placeholder={`Search ${tab === 'installed' ? 'plugins' : tab}…`} value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear plugin search" onClick={() => setSearch('')}><X size={13} /></button>}</label></div>
    {error && <div className="inline-alert" role="alert">{error}<button className="text-button" onClick={() => void load()}>Retry</button></div>}
    {notice && <div className="catalog-notice" role="status"><Check size={15} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss plugin notice" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {loading ? <div className="panel-loading"><LiteSpeed compact active />Loading…</div> : <div role="tabpanel" aria-label={tab === 'installed' ? 'Installed plugins' : tab === 'skills' ? 'Skills' : 'Connections'}>
      {tab === 'installed' && <>{installed.length ? <div className="catalog-grid">{installed.map(([name, plugin]) => <article className="catalog-card" key={name}><div className="catalog-card-heading"><span className="catalog-icon"><Package size={23} /></span><span className="catalog-installed"><Check size={12} />Installed</span></div><h2>{name}</h2><p>{plugin.description || 'A collection of tools for this project.'}</p><footer><span>{plugin.items.length} {plugin.items.length === 1 ? 'item' : 'items'} · v{plugin.version}</span><button className="icon-button" aria-label={`Remove ${name}`} title="Remove plugin" onClick={() => { setRemoving(name); setDialogError(''); }}><Trash2 size={14} /></button></footer></article>)}</div> : <EmptyState icon={<Package size={32} />} title={search ? 'No matching plugins' : 'No plugins yet'}>{search ? 'Try another search.' : <>Add a plugin from a local folder to bring in skills, commands, and connections.<button className="button secondary" onClick={startInstall}><Plus size={15} />Add your first plugin</button></>}</EmptyState>}</>}
      {tab === 'skills' && <><div className="catalog-section-actions"><span>{catalog?.skills.length || 0} skills in this project</span><button className="text-button" onClick={() => setImporting(true)}><Download size={14} />Import skills</button><button className="text-button" onClick={onSkills}><Settings2 size={14} />Manage skills</button></div>{skills.length ? <div className="catalog-grid">{skills.map(skill => <button className="catalog-card skill-catalog-card" key={skill.id} onClick={onSkills}><span className="catalog-icon"><Sparkles size={23} /></span><h2>{skill.name}</h2><p>{skill.description}</p><footer><code>${skill.id}</code><ChevronRight size={15} /></footer></button>)}</div> : <EmptyState icon={<Sparkles size={32} />} title={search ? 'No matching skills' : 'No skills yet'}>Import your existing Codex or Claude skills to get started.</EmptyState>}{Boolean(diagnostics.length) && <details className="catalog-diagnostics"><summary>Some project skills need attention</summary>{diagnostics.map((issue, i) => <p key={i}>{issue.path}: {issue.message}</p>)}</details>}</>}
      {tab === 'connections' && <><div className="catalog-section-actions"><span>{connections.length} connections</span><button className="text-button" onClick={onConnections}><Plus size={14} />Manage connections</button></div>{servers.length ? <div className="catalog-grid">{servers.map(server => <button className="catalog-card" key={server.name} onClick={onConnections}><div className="catalog-card-heading"><span className="catalog-icon"><Unplug size={23} /></span><span className={`connection-status-label ${server.status}`}><i />{server.status.replaceAll('_', ' ')}</span></div><h2>{server.name}</h2><p>{server.error || `${server.tools.length} tools available`}</p><footer><span>Connection settings</span><ChevronRight size={15} /></footer></button>)}</div> : <EmptyState icon={<Unplug size={32} />} title={search ? 'No matching connections' : 'No connections yet'}>Connect your services or import your existing setup.<button className="button secondary" onClick={onConnections}>Add a connection</button></EmptyState>}</>}
    </div>}
    {installing && <Modal title={reviewed ? `Install ${reviewed.plan.plugin.name}` : 'Add a plugin'} onClose={() => { if (!busy) setInstalling(false); }}>
      <div className="plugin-install-body">{reviewed ? <><p>{reviewed.plan.plugin.description || 'Review what this plugin will add to your project.'}</p><div className="plugin-install-plan">{reviewed.plan.actions.map((item, i) => <div key={i}><span className="plugin-kind">{item.kind}</span><div><strong>{item.name}</strong><span>{item.target}</span>{item.conflict && <em>{item.conflict === 'exists' ? 'Already exists · will be skipped' : 'Updates installed item'}</em>}<details><summary>Details</summary><pre>{item.preview}</pre></details></div></div>)}</div>{reviewed.plan.warnings.map((warning, i) => <p className="field-hint" key={i}>{warning}</p>)}{reviewed.plan.actions.some(item => item.kind === 'mcp' || item.kind === 'hook') && <p className="field-hint">Connections and hooks are added disabled. You can enable them in Settings.</p>}</> : <><p>Choose a plugin folder on this computer.</p><label className="plugin-source"><Folder size={16} /><input autoFocus aria-label="Plugin folder" placeholder="/path/to/plugin" value={source} disabled={busy} onChange={e => setSource(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void review(); } }} /></label><p className="field-hint">Supports Litespeed and compatible Claude plugin folders.</p></>}{dialogError && <div className="inline-alert" role="alert">{dialogError}</div>}</div>
      <div className="modal-footer">{reviewed && <button className="text-button" disabled={busy} onClick={() => setReviewed(null)}><ArrowLeft size={14} />Choose another</button>}<button className="button secondary" disabled={busy} onClick={() => setInstalling(false)}>Cancel</button><button className="button primary" disabled={busy || (!reviewed && !source.trim())} onClick={() => void (reviewed ? install() : review())}>{busy ? 'Working…' : reviewed ? 'Install plugin' : 'Review plugin'}</button></div>
    </Modal>}
    {removing && <Modal title={`Remove ${removing}?`} onClose={() => { if (!busy) setRemoving(null); }}><div className="plugin-install-body"><p>Remove this plugin’s installed files and connections. Files you have edited are kept.</p>{dialogError && <div className="inline-alert" role="alert">{dialogError}</div>}</div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button><button className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Remove plugin'}</button></div></Modal>}
    {importing && <Modal title="Import skills" wide onClose={() => setImporting(false)}><div className="plugin-import-body"><SkillImporter workspace={workspace} onClose={() => setImporting(false)} onImported={() => { void load(); onChanged(); }} /></div></Modal>}
  </section>;
}
