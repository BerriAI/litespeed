import { permissionModeLabels } from '../../shared/permissions.js';
import { LiteFusionSettings } from './LiteFusionSettings';
import { bindExactModels, type LiteFusionSelection } from '../../shared/litefusion';
import { useEffect, useState, type ReactNode } from 'react';
import { shuntConfigured } from '../../shared/shunt';
import { Check } from 'lucide-react';
import { architectureWorker, selectArchitecture, type ArchitectureKind } from '../../shared/architectures';
import { SETUP_ARCHITECTURES, SETUP_PERMISSIONS, modelGuidance, GATEWAY_URL_HINT, GATEWAY_KEY_HINT, gatewayBaseUrl, setupGateway, providerIsConfigured, sidekickPreset, sidekickPresetNotice, type GatewayConnection } from '../../shared/setup';
import type { Model, Settings } from '../../shared/types';
import type { Selection } from './Composer';
import { ModelField, ShuntSettings } from './ModelPicker';
import { Logo, Modal } from './ui';
import { api, errorMessage, post } from './api';
import { liteFusionPreset, liteFusionConfiguration, specialistGateway, withLiteFusionLead } from '../../shared/architecture-config';
import { SkillImporter } from './SkillImporter';

export function Onboarding({ settings, selection, workspace, onSave, onClose, renderProviders, onSettings, quick = false }: { settings: Settings; quick?: boolean; selection: Selection; workspace: string; onSave: (next: Selection) => Promise<void>; onClose: () => void; onSettings: (settings: Settings) => void; renderProviders: (close: () => void) => ReactNode }) {
  const [shuntPending,setShuntPending]=useState(false);
  const [providers, setProviders] = useState(false);
  const [skills, setSkills] = useState(false);
  const [simple, setSimple] = useState(quick);
  const connected = settings.providers.some(p => p.id === selection.providerId && providerIsConfigured(p));
  const [autoProvider] = useState(connected && !selection.model && !selection.architecture ? selection.providerId : null);
  const [loading, setLoading] = useState(Boolean(autoProvider)), [presetNotice, setPresetNotice] = useState('');
  const [step, setStep] = useState(connected ? 2 : 0), [kind, setKind] = useState<'single' | ArchitectureKind>(selection.architecture?.kind ?? (quick || !selection.model ? 'sidekick-fusion' : 'single'));
  const [draft, setDraft] = useState(selection), [worker, setWorker] = useState(selection.architecture ? architectureWorker(selection.architecture) : null);
  const [fusion,setFusion]=useState<LiteFusionSelection>(selection.architecture?.kind==='litefusion'?selection.architecture:{kind:'litefusion',gatewayProviderId:selection.providerId||settings.providers.find(p=>p.kind!=='codex')?.id||''});
  const [open, setOpen] = useState<string | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [gateway, setGateway] = useState(() => setupGateway(settings, selection.providerId));
  const [baseUrl, setBaseUrl] = useState(gateway.baseUrl), [apiKey, setApiKey] = useState('');
  const [connection, setConnection] = useState('');
  const label = kind === 'expert-fusion' ? 'Expert' : kind === 'team-fusion' ? 'Worker' : 'Sidekick';
  const valid = (kind==='litefusion'||!shuntPending&&shuntConfigured(draft.shunt,settings.providers)) && Boolean(draft.model && settings.providers.some(provider => provider.id === draft.providerId) && (kind === 'single' || kind === 'litefusion' || worker?.model && settings.providers.some(provider => provider.id === worker.providerId)));
  useEffect(() => {
    if (!autoProvider) return;
    let live = true;
    api<{models:Model[]}>(`/models?providerId=${encodeURIComponent(autoProvider)}`).then(({models}) => {
      if (!live) return;
      const preset = sidekickPreset(autoProvider, models);
      setDraft(current => ({...current,...preset})); setWorker(architectureWorker(preset.architecture!)); setPresetNotice(sidekickPresetNotice(preset));
    }).catch(error => {if(live)setError(errorMessage(error));}).finally(() => {if(live)setLoading(false);});
    return () => {live=false;};
  }, [autoProvider]);
  useEffect(()=>{
    if(kind!=='litefusion'||fusion.lead||selection.architecture?.kind==='litefusion')return;
    const providerId=specialistGateway(settings.providers,draft.providerId);if(!providerId)return;
    let live=true;setSaving(true);
    api<{selection:LiteFusionSelection;discoveryError?:string}>(`/litefusion/preset?providerId=${encodeURIComponent(providerId)}`).then(result=>{if(live){setFusion(result.selection);setDraft(current=>({...current,...liteFusionConfiguration(result.selection)}));setError(result.discoveryError??'');}}).catch(error=>{if(live)setError(errorMessage(error));}).finally(()=>{if(live)setSaving(false);});
    return()=>{live=false;};
  },[kind,settings.providers]);
  const changeFusion=(value:LiteFusionSelection)=>{setFusion(value);if(kind==='litefusion')setDraft(current=>({...current,...liteFusionConfiguration(value,current)}));};
  async function connect() {
    setSaving(true); setError('');
    try {
      const result = await post<GatewayConnection>('/providers/connect', { providerId: gateway.providerId, baseUrl: gatewayBaseUrl(baseUrl), ...(apiKey.trim() ? {apiKey: apiKey.trim()} : {}) });
      const connectedPreset=liteFusionPreset(result.providerId,result.models);setFusion(connectedPreset);
      onSettings(result.settings); setGateway({providerId: result.providerId, baseUrl: baseUrl.trim(), existing: true}); setApiKey('');
      applyConnectedModels(result.providerId,result.models);
      if(kind==='litefusion')setDraft(current=>({...current,...liteFusionConfiguration(connectedPreset)}));
      setConnection(`Connected · ${result.models.length} models available`); setStep(2); setOpen(null);
    } catch (error) { setError(errorMessage(error)); } finally { setSaving(false); }
  }
  function applyConnectedModels(providerId: string, models: Model[]) {
    const preset = sidekickPreset(providerId,models);
    const nextModel = draft.providerId===providerId && models.some(model=>model.id===draft.model) ? draft.model : kind==='sidekick-fusion'?preset.model:'';
    const nextWorker = worker?.providerId===providerId && models.some(model=>model.id===worker.model) ? worker : kind==='sidekick-fusion'?architectureWorker(preset.architecture!):null;
    setDraft(current=>({...current,providerId,model:nextModel,shunt:current.shunt?.enabled&&current.shunt.model.providerId===providerId&&!models.some(model=>model.id===current.shunt!.model!.model)?{...current.shunt,model:{providerId,model:''}}:current.shunt??{enabled:false}}));
    setWorker(nextWorker);
    setPresetNotice(kind==='sidekick-fusion'?sidekickPresetNotice({...preset,model:nextModel,architecture:selectArchitecture('sidekick-fusion',nextWorker!)}):'');
  }
  async function save() {
    setSaving(true); setError('');
    try { await onSave(kind==='litefusion'?{...draft,...liteFusionConfiguration(fusion,draft)}:{ ...draft, architecture: kind === 'single' ? null : selectArchitecture(kind, worker!) }); onClose(); }
    catch (error) { setError(errorMessage(error)); } finally { setSaving(false); }
  }
  if (skills) return <Modal title="Import a Claude/Codex skill" onClose={() => setSkills(false)}><SkillImporter workspace={workspace} onClose={() => setSkills(false)} onImported={() => setSkills(false)} /></Modal>;
  if (providers) return renderProviders(() => { const next = setupGateway(settings, settings.defaultProvider); setGateway(next); setBaseUrl(next.baseUrl); setApiKey(''); setProviders(false); });
  return <Modal title="Set up Litespeed" onClose={() => { if (!saving) onClose(); }}>
    <div className="setup-intro"><Logo /><div><p>{step === 0 ? 'Connect your LiteLLM gateway' : step === 1 ? 'How would you like to work?' : kind==='litefusion'?'Your LiteFusion setup':'Review your setup'}</p><small>{step === 0 ? 'Enter your connection to get started.' : 'You can change any setting now or later.'}</small></div></div>
    <div className="setup-content">
      {step === 0 ? <form id="gateway-setup" className="setup-gateway" onSubmit={event => { event.preventDefault(); if (!saving) void connect(); }}>
        <label>Gateway base URL<input type="url" autoFocus required placeholder="https://your-gateway.example.com" value={baseUrl} disabled={saving} onChange={event => setBaseUrl(event.target.value)} spellCheck={false} /><span className="field-hint">{GATEWAY_URL_HINT}</span></label>
        <label>API key<input type="password" autoComplete="off" placeholder={gateway.existing && baseUrl === gateway.baseUrl ? 'Leave blank to keep your saved key' : 'Enter your LiteLLM API key'} value={apiKey} disabled={saving} onChange={event => setApiKey(event.target.value)} /><span className="field-hint">{GATEWAY_KEY_HINT}</span></label>
        <p className="field-hint">Connect to check your gateway and load the models available to your key.</p>
        <button type="button" className="text-button" disabled={saving} onClick={() => setProviders(true)}>Use another provider</button>
        {settings.providers.filter(provider => provider.kind !== 'openai').map(provider => <button key={provider.id} type="button" className="text-button" disabled={saving} onClick={() => {
          setError('');setLoading(true);setStep(2);
          api<{models:Model[]}>(`/models?providerId=${encodeURIComponent(provider.id)}`).then(({models})=>applyConnectedModels(provider.id,models)).catch(error=>setError(errorMessage(error))).finally(()=>setLoading(false));
        }}>Continue with {provider.name}</button>)}
      </form> : step === 1 ? <div className="setup-options" role="group" aria-label="Architecture">{SETUP_ARCHITECTURES.map(item => <button key={item.kind} className={`setup-option ${kind === item.kind ? 'selected' : ''}`} aria-pressed={kind === item.kind} onClick={() => setKind(item.kind)}><span><strong>{item.name}{item.recommended && <span className="recommended-label">Recommended</span>}</strong><small>{item.description}</small></span>{kind === item.kind && <Check size={16} />}</button>)}</div> : loading ? <p role="status">Choosing available models…</p> : <>
        <label className="setup-architecture">Setup<select aria-label="Setup architecture" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setPresetNotice(''); setOpen(null); }}>{SETUP_ARCHITECTURES.map(item => <option key={item.kind} value={item.kind}>{item.name}{item.recommended ? ' · Recommended' : ''}</option>)}</select></label>
        <p className="field-hint">{SETUP_ARCHITECTURES.find(item => item.kind === kind)?.description}</p>
        {!settings.providers.length ? <p className="field-hint">Connect a provider to see its models.</p> : <div className="setup-models">
          <ModelField simple hint={modelGuidance(kind, 'driver')} label={kind === 'single' ? 'Model' : kind==='litefusion'?'Lead':'Driver'} settings={settings} selection={draft} value={draft.model ? draft : null} onChange={route => {setPresetNotice('');if(kind==='litefusion')changeFusion(withLiteFusionLead(fusion,route,fusion.lead?.effort));else setDraft({...draft,...route});}} onReasoning={() => {}} open={open === 'driver'} onOpen={value => setOpen(value ? 'driver' : null)} />
          {kind !== 'single' && kind !== 'litefusion' && <ModelField simple hint={modelGuidance(kind, 'worker')} label={label} settings={settings} selection={draft} value={worker} onChange={value=>{setPresetNotice('');setWorker(value);}} onReasoning={() => {}} open={open === 'worker'} onOpen={value => setOpen(value ? 'worker' : null)} />}
        </div>}
        {kind==='litefusion' && <LiteFusionSettings compact value={fusion} settings={settings} onChange={changeFusion}/>}
        {kind!=='litefusion'&&<ShuntSettings settings={settings} selection={draft} onChange={shunt=>setDraft({...draft,shunt})} onPending={setShuntPending}/>}
        <div className="setup-links"><button className="text-button" onClick={() => simple ? setStep(0) : setProviders(true)}>{simple ? 'Change gateway' : 'Manage providers'}</button>
        {simple && <button className="text-button" onClick={() => { setSimple(false); setStep(1); setOpen(null); }}>Customize setup</button>}</div>
        <label className="model-setting-row setup-permissions">Permissions<select aria-label="Setup permissions" value={draft.permissionMode} onChange={event => setDraft({ ...draft, permissionMode: event.target.value as 'ask' | 'edit' | 'auto' })}><option value="ask">Ask first</option><option value="edit">Allow project edits</option><option value="auto">Allow all tools</option></select></label>
        <p className="field-hint">{SETUP_PERMISSIONS} Saved for new sessions in this project, including workers.</p>
        <div className="setup-links"><button className="text-button" onClick={() => setSkills(true)}>Import Claude/Codex skills from your machine</button></div>
      </>}
      {step > 0 && connection && <p className="field-hint">{connection}</p>}
      {step === 2 && presetNotice && <p role="status" className="field-hint">{presetNotice}</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
    <div className="model-picker-footer"><button className="text-button" disabled={saving || loading} onClick={() => { setError(''); step === 0 ? onClose() : setStep(simple ? 0 : step - 1); }}>{step === 0 ? 'Set up later' : 'Back'}</button><button className="button primary" type={step === 0 ? "submit" : "button"} form={step === 0 ? "gateway-setup" : undefined} disabled={saving || loading || step === 0 && !baseUrl.trim() || step === 2 && !valid} onClick={() => { if (step === 1) setStep(2); else if (step === 2) void save(); }}>{loading ? 'Choosing models…' : saving ? step === 0 ? 'Connecting…' : 'Saving…' : step === 0 ? 'Connect & continue' : step === 1 ? 'Continue' : simple ? 'Start chatting' : 'Start with this setup'}</button></div>
  </Modal>;
}
