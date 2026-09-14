import { ProviderError } from './providers.js';

/** Only explicit provider rejection is eligible for automatic rerouting.
 * A dropped stream or POST may have been billed; retain evidence for the lead. */
export function unavailableRoute(error: unknown): string | undefined {
  if (!(error instanceof ProviderError) || !error.status || error.contextOverflow) return;
  if (['network_error', 'stream_interrupted'].includes(error.code ?? '')) return;
  if (error.retryable || [401, 403, 404, 402].includes(error.status) ||
      ['model_not_found', 'model_not_supported', 'invalid_model', 'insufficient_quota', 'quota_exceeded', 'quota_exhausted', 'usage_limit_reached', 'billing_hard_limit_reached', 'billing_not_active', 'budget_exceeded', 'insufficient_credits'].includes(error.code ?? ''))
    return error.message;
}
