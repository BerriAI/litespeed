import { useEffect, useRef, useState } from 'react';
import type { Model, Settings } from '../../shared/types';
import { LITEFUSION_CAPABILITIES, LITEFUSION_MODELS, LITEFUSION_ROLES, LITEFUSION_VERSION, bindExactModels, configuredRole, liteFusionPolicy, parseLiteFusionPolicy, specialistRoute, type LiteFusionSelection, type LiteFusionRouteStatus, type LiteFusionTier } from '../../shared/litefusion';
import { api, post, errorMessage } from './api';

type Preview = { routes: Record<string, Record<LiteFusionTier, LiteFusionRouteStatus>> };
export function LiteFusionSettings({ value, settings, onChange }: { value: LiteFusionSelection; settings: Settings; onChange: (value: LiteFusionSelection) => void }) {
  const [search, setSearch] = useState(''), [selected, setSelected] = useState(LITEFUSION_ROLES[0].id);
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const file = useRef<HTMLInputElement>(null), revision = useRef(value); revision.current = value;
  useEffect(() => { let live = true; setPreview(null); post<Preview>('/litefusion/routes', value).then(result => { if (live) { setPreview(result); setError(''); } }).catch(e => { if (live) setError(errorMessage(e)); }); return () => { live = false; }; }, [value]);
  const role = configuredRole(value, selected), models = Object.entries(LITEFUSION_MODELS);
  async function discover() {
    const captured = value; setLoading(true); setError('');
    try { const result = await api<{models: Model[];error?:string}>(`/models?providerId=${encodeURIComponent(value.gatewayProviderId)}`); if (revision.current !== captured) return; if (result.error) setError(result.error); onChange(bindExactModels(value, result.models)); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }
  async function importPolicy(source: File) {
    const captured = value;
    try { if (source.size > 1024 * 1024) throw new Error('Policy exceeds 1 MiB.'); const next = parseLiteFusionPolicy(await source.text()); await post('/litefusion/routes', next); if (revision.current !== captured) throw new Error('Settings changed while importing. Import again to review the current policy.'); onChange(next); }
    catch (e) { setError(errorMessage(e)); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(liteFusionPolicy(value), null, 2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'litefusion-policy.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="litefusion-settings" aria-label="LiteFusion task routing">
    <p className="field-hint">63 task cards · policy {LITEFUSION_VERSION}. Research recommendations; runtime performance is not yet evaluated.</p>
    <label>Specialist gateway<select aria-label="Specialist gateway" value={value.gatewayProviderId} onChange={event => onChange({...value, gatewayProviderId:event.target.value})}>{settings.providers.filter(p => p.kind !== 'codex').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="litefusion-actions"><button type="button" className="text-button" disabled={loading} onClick={() => void discover()}>{loading?'Refreshing…':'Refresh and pin exact models'}</button><button type="button" className="text-button" onClick={download}>Export policy</button><button type="button" className="text-button" onClick={() => file.current?.click()}>Import policy</button></div>
    <input ref={file} type="file" accept="application/json,.json" hidden aria-label="Import LiteFusion policy" onChange={event => { if(event.target.files?.[0]) void importPolicy(event.target.files[0]); event.target.value=''; }} />
    {error && <p role="alert" className="error-text">{error}</p>}
    <label>Search all 63 tasks<input aria-label="Search LiteFusion tasks" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Security, testing, docs…" /></label>
    <select aria-label="LiteFusion task" value={selected} onChange={event=>setSelected(event.target.value)} size={5}>{LITEFUSION_ROLES.filter(r=>`${r.task} ${r.id}`.toLowerCase().includes(search.toLowerCase())).map(r=><option key={r.id} value={r.id}>{r.task}{r.execution==='lead'?' · Lead':''}</option>)}</select>
    <strong>{role.task}</strong><p className="field-hint">{role.execution==='lead'?'Handled directly by your selected lead. The research routes below remain visible for reference.':`Scope: ${role.execution}. Stakes: ${role.stakes}.`}</p>
    {(['default','escalation'] as const).map(tier=>{
      const route=specialistRoute(value,role,tier), status=preview?.routes[role.id]?.[tier];
      const change=(next:typeof route)=>onChange({...value,routes:{...value.routes,[role.id]:{...value.routes?.[role.id],[tier]:next}}});
      return <div key={tier} className="litefusion-route"><label>{tier==='default'?'Default model':'Hard / escalation model'}<select aria-label={`${tier} model`} disabled={role.execution==='lead'} value={route.modelKey} onChange={event=>{const card=LITEFUSION_MODELS[event.target.value];change({modelKey:event.target.value,effort:card.efforts.includes(route.effort)?route.effort:card.efforts.at(-1)!});}}>{models.map(([key,model])=><option key={key} value={key}>{model.name}</option>)}</select></label><label>Reasoning<select aria-label={`${tier} reasoning`} disabled={role.execution==='lead'} value={route.effort} onChange={event=>change({...route,effort:event.target.value})}>{LITEFUSION_MODELS[route.modelKey].efforts.map(effort=><option key={effort}>{effort}</option>)}</select></label><p className="field-hint">{status?`${status.status}${status.route?` · ${status.route.model} / ${status.effort}`:''}${status.reason?` · ${status.reason}`:''}`:'Checking configuration…'}</p></div>;
    })}
    <details><summary>Task handoff and evidence</summary><label>Handoff instructions<textarea rows={5} aria-label="Task handoff instructions" value={role.handoff} onChange={event=>onChange({...value,handoffs:{...value.handoffs,[role.id]:{instructions:event.target.value,acceptance:role.acceptance}}})}/></label><label>Required evidence<textarea rows={3} aria-label="Task required evidence" value={role.acceptance} onChange={event=>onChange({...value,handoffs:{...value.handoffs,[role.id]:{instructions:role.handoff,acceptance:event.target.value}}})}/></label><p className="field-hint">{role.evidence} · {role.confidence}</p>{role.sources.map(url=><a key={url} href={url} target="_blank" rel="noreferrer">Source</a>)}</details>
    <details><summary>Gateway identity bindings · {Object.keys(value.bindings??{}).length}</summary><p className="field-hint">Bind an alias only when it deploys this exact model. A configured route has not been execution-tested. Mercury Edit 2 and Voyage Code 4 are unavailable; their task cards use explicit chat fallbacks.</p>{models.filter(([key])=>!['mercury_edit','voyage_code'].includes(key)).map(([key,model])=>{
      const binding=value.bindings?.[key];
      return <div className="litefusion-binding" key={key}><label>{model.name}<input aria-label={`${model.name} deployment`} placeholder={model.apiId} value={binding?.model??''} onChange={event=>{const bindings={...value.bindings};if(event.target.value.trim())bindings[key]={providerId:binding?.providerId??value.gatewayProviderId,model:event.target.value};else delete bindings[key];onChange({...value,bindings});}}/></label><select aria-label={`${model.name} provider`} value={binding?.providerId??value.gatewayProviderId} disabled={!binding} onChange={event=>onChange({...value,bindings:{...value.bindings,[key]:{...binding!,providerId:event.target.value}}})}>{settings.providers.filter(p=>p.kind!=='codex').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>;
    })}</details>
    <details><summary>Worker limits and environment</summary><label>Workers at once<select aria-label="LiteFusion concurrency" value={value.concurrency??2} onChange={event=>onChange({...value,concurrency:Number(event.target.value) as 1|2|3|4})}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label><label>Assignments per turn<input aria-label="LiteFusion assignment limit" type="number" min={1} max={32} value={value.maxAssignments??8} onChange={event=>{const n=Number(event.target.value);if(Number.isInteger(n)&&n>=1&&n<=32)onChange({...value,maxAssignments:n});}}/></label><p className="field-hint">Declare only capabilities your workspace actually provides. This does not connect tools or install hardware.</p>{LITEFUSION_CAPABILITIES.map(cap=><label key={cap}><input type="checkbox" checked={value.capabilities?.includes(cap)??false} onChange={event=>onChange({...value,capabilities:event.target.checked?[...value.capabilities??[],cap]:value.capabilities?.filter(c=>c!==cap)})}/>{cap.replaceAll('_',' ')}</label>)}</details>
  </section>;
}
