// Maps our provider ids (connections/providers.ts) to the provider prefix
// LiteLLM expects in `litellm_params.model`. A single private model per AI is
// registered as `ai-<aiId>` pointing at `<prefix>/<the model the owner chose>`,
// so the AI's virtual key only ever reaches the owner's own key.
//
// `github` is not an LLM provider: it is used for git integration only, and the
// service rejects it with `connection_not_llm`.
const LITELLM_MODEL_PREFIX: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'gemini',
  deepseek: 'deepseek',
  xai: 'xai',
  openrouter: 'openrouter',
};

export function isLlmProvider(provider: string): boolean {
  return Object.prototype.hasOwnProperty.call(LITELLM_MODEL_PREFIX, provider);
}

// The provider-qualified model LiteLLM routes to, e.g. `openai/gpt-4o-mini`.
// The caller has already checked the provider is an LLM provider; an unknown or
// non-LLM one is a programming error, not a user error.
export function litellmModelFor(provider: string, model: string): string {
  const prefix = LITELLM_MODEL_PREFIX[provider];
  if (prefix === undefined) {
    throw new Error(`Provider "${provider}" is not an LLM provider`);
  }
  return `${prefix}/${model}`;
}
