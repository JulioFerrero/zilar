// The providers a connection can be created with, and the subset that can back
// an AI. Web and mobile share this one list, so the add-key forms and the AI
// wizard never drift apart.
//
// `github` is a git integration, not an LLM provider: the server refuses it for
// an AI (`apps/server/src/connections/providers.ts`, `isLlmProvider`), so the
// wizard hides it while Settings → Connections still offers it.
export interface AiProvider {
  readonly id: string;
  readonly label: string;
}

/** Every provider, GitHub included. The ids match `PROVIDER_IDS` in the API contract. */
export const AI_PROVIDERS: readonly AiProvider[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'xai', label: 'xAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'openai-compatible', label: 'OpenAI-compatible' },
  { id: 'github', label: 'GitHub' },
];

export const AI_PROVIDER_IDS: readonly string[] = AI_PROVIDERS.map((provider) => provider.id);

/**
 * The ids that can back an AI: the same set the server treats as LLM
 * providers. `github` is deliberately absent.
 */
export const LLM_PROVIDER_IDS: readonly string[] = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  // T-1396: any OpenAI-compatible endpoint the user supplies.
  'openai-compatible',
];

/** The wizard's provider list: `AI_PROVIDERS` without the non-LLM providers. */
export const LLM_PROVIDERS: readonly AiProvider[] = AI_PROVIDERS.filter((provider) =>
  LLM_PROVIDER_IDS.includes(provider.id),
);

/** Whether a connection with this provider can run an AI (GitHub cannot). */
export function isLlmProvider(id: string): boolean {
  return LLM_PROVIDER_IDS.includes(id);
}

/** The display label for a provider id; an unknown id is shown as-is. */
export function providerLabel(id: string): string {
  return AI_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}
