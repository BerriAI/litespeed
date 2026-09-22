import { describe, expect, it } from 'vitest';
import { defaultSetupModel } from '../shared/setup-models.js';
import { sidekickPreset, sidekickPresetNotice } from '../shared/setup.js';

const catalog = (...ids: string[]) => ids.map(id => ({id}));
describe('automatic Sidekick setup', () => {
  it('picks Astra 6 and Sol 6, with Sidekick Fusion and Shunt off', () => {
    const preset = sidekickPreset('gateway',catalog('anthropic/claude-fable-5-1','anthropic/claude-opus-5-5','openai/gpt-6-sol','openai/gpt-6-astra','gpt-6-astra','gpt-5.6-sol'));
    expect(preset).toMatchObject({providerId:'gateway',model:'openai/gpt-6-astra',architecture:{kind:'sidekick-fusion',sidekick:{providerId:'gateway',model:'openai/gpt-6-sol'}},shunt:{enabled:false}});
    expect(sidekickPresetNotice(preset)).toBe('');
  });
  it('falls back to Fable and Opus independently, then to each remaining family', () => {
    const models = catalog('claude-fable-5-1','claude-opus-5-5');
    expect(defaultSetupModel(models,'driver')).toBe('claude-fable-5-1');
    expect(defaultSetupModel(models,'sidekick')).toBe('claude-opus-5-5');
    expect(defaultSetupModel([...models,{id:'gpt-6-astra'}],'sidekick')).toBe('claude-opus-5-5');
    expect(defaultSetupModel(catalog('claude-opus-5-5','gpt-6-sol'),'driver')).toBe('claude-opus-5-5');
    for (const id of ['gpt-6-astra','claude-fable-5-1','claude-opus-5-5','gpt-6-sol']) {
      expect(defaultSetupModel(catalog(id),'driver')).toBe(id);
      expect(defaultSetupModel(catalog(id),'sidekick')).toBe(id);
    }
  });
  it('prioritizes family before version and compares version components numerically', () => {
    expect(defaultSetupModel(catalog('gpt-5-astra','claude-fable-6','claude-opus-7'),'driver')).toBe('gpt-5-astra');
    expect(defaultSetupModel(catalog('claude-fable-5-9','claude-fable-5-10','claude-fable-5-1-20260922'),'driver')).toBe('claude-fable-5-10');
    expect(defaultSetupModel(catalog('gpt-5.6-sol','gpt-6-sol','gpt-6.1-sol'),'sidekick')).toBe('gpt-6.1-sol');
  });
  it('handles dated versions, provider prefixes, legacy names and explicit aliases', () => {
    expect(defaultSetupModel(catalog('claude-opus-4-5-20251101','claude-opus-4-6-20260205','claude-3-opus-20240229'),'driver')).toBe('claude-opus-4-6-20260205');
    expect(defaultSetupModel(catalog('claude-fable-5-1-20260901','claude-fable-5-1-20260922'),'driver')).toBe('claude-fable-5-1-20260922');
    expect(defaultSetupModel(catalog('bedrock/global.anthropic.claude-fable-5-1-v1:0','openrouter/anthropic/claude-fable-5.1'),'driver')).toBeTruthy();
    expect(defaultSetupModel([{id:'team-lead',canonicalId:'openai/gpt-6-astra'}],'driver')).toBe('team-lead');
  });
  it('does not guess from display labels, partial names or unsupported variants', () => {
    const models = catalog('my-astra','claude-fable-5-1-thinking','gpt-6-sol-mini','batch/openai/gpt-6-astra','claude-opus-5-5-batch','unknown');
    models.push({id:'custom'});
    const preset = sidekickPreset('gateway',models);
    expect(preset.model).toBe('');
    expect(preset.architecture).toMatchObject({sidekick:{model:''}});
    expect(sidekickPresetNotice(preset)).toContain('Choose a model for your driver and sidekick');
    expect(defaultSetupModel([],'driver')).toBe('');
  });
});
