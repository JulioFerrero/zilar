// `github` is a git integration, not an LLM provider: the server refuses it for an AI, so the wizard hides it while Connections still offers it.
export interface AiProvider {
  readonly id: string;
  readonly label: string;
}

// The ids match `PROVIDER_IDS` in the API contract.
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

// The ids that can back an AI; `github` is deliberately absent.
export const LLM_PROVIDER_IDS: readonly string[] = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  'openai-compatible',
];

export const LLM_PROVIDERS: readonly AiProvider[] = AI_PROVIDERS.filter((provider) =>
  LLM_PROVIDER_IDS.includes(provider.id),
);

export function isLlmProvider(id: string): boolean {
  return LLM_PROVIDER_IDS.includes(id);
}

export function providerLabel(id: string): string {
  return AI_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}
