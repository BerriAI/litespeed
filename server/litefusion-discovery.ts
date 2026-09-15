import { modelCatalog, providerIdentity } from './budget.js';
import { listModels } from './providers.js';
import type { Provider } from '../shared/types.js';
import type { LiteFusionSelection } from '../shared/litefusion.js';

/** Catalog requests only. Never a classifier, completion, probe or benchmark.
 * Shared in-flight requests have their own timeout; one closing tab cannot
 * cancel discovery needed by another session. Failed discovery backs off.
 */
export class LiteFusionDiscovery {
  private requests=new Map<string,Promise<void>>();
  private failures=new Map<string,number>();
  constructor(private discover= listModels, private now=()=>Date.now()) {}
  async ensure(selection:LiteFusionSelection,providers:readonly Provider[],force=false):Promise<string|undefined> {
    const ids=new Set([selection.gatewayProviderId,...Object.values(selection.bindings??{}).map(binding=>binding.providerId)]);
    await Promise.all(providers.filter(provider=>ids.has(provider.id)&&provider.kind!=='codex'&&provider.baseUrl).map(async provider=>{
      const key=providerIdentity(provider);
      if(!force && modelCatalog.snapshot(provider).length){this.failures.delete(key);return;}
      if(!force && this.now()-(this.failures.get(key)??-Infinity)<30_000)return;
      let pending=this.requests.get(key);
      if(!pending) {
        pending=this.discover(provider,AbortSignal.timeout(5000)).then(models=>{
          modelCatalog.remember(provider,models);this.failures.delete(key);
          // Empty listings must not cause a request on every UI render.
          if(!models.length)this.failures.set(key,this.now());
        },()=>{this.failures.set(key,this.now());}).finally(()=>{this.requests.delete(key);});
        this.requests.set(key,pending);
        while(this.failures.size>60)this.failures.delete(this.failures.keys().next().value!);
      }
      await pending;
    }));
    return providers.some(provider=>ids.has(provider.id)&&this.failures.has(providerIdentity(provider)))
      ? 'Model discovery is unavailable or returned no models. Saved connections are preserved; unrecognized specialists use their backup or the lead.' : undefined;
  }
}
