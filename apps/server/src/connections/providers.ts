import { catalogBaseUrl } from '../ai/catalog';

// `github` is deliberately absent: it is a git integration, not an LLM provider.
const LLM_PROVIDER_IDS: readonly string[] = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  'openai-compatible',
];

// A catalog provider can run an AI; `hasBaseUrl` lets an existing catalog
// connection keep running across a restart, when the map is still cold.
export function isLlmProvider(provider: string, hasBaseUrl = false): boolean {
  if (provider === 'github') {
    return false;
  }
  return LLM_PROVIDER_IDS.includes(provider) || hasBaseUrl || catalogBaseUrl(provider) !== null;
}
