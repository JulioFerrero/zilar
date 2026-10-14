// The provider ids live in the shared contract (`@zilar/api-contract`,
// `connections.ts`, T-0893); the service and the probe import them from here.
export { PROVIDER_IDS, ProviderIdSchema, type ProviderId } from '@zilar/api-contract';

// The providers that can back an AI. `github` is deliberately absent: it is a
// git integration, not an LLM provider, so the AI routes refuse it.
const LLM_PROVIDER_IDS: readonly string[] = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  // T-1396: a user's own OpenAI-compatible endpoint.
  'openai-compatible',
];

/** Whether a connection with this provider can run an AI (GitHub cannot). */
export function isLlmProvider(provider: string): boolean {
  return LLM_PROVIDER_IDS.includes(provider);
}
