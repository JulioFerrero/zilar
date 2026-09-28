// A short, static hint list per provider, rendered as an HTML `<datalist>`.
// The model input is always editable. A models.dev picker with prices is out of
// scope for this task.
const MODEL_SUGGESTIONS: Record<string, readonly string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  anthropic: ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  xai: ['grok-4', 'grok-3', 'grok-3-mini'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
};

export function modelSuggestionsFor(provider: string): readonly string[] {
  return MODEL_SUGGESTIONS[provider] ?? [];
}
