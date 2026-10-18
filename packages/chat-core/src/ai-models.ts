// The model input is always editable; these hints are the picker's fallback when models.dev cannot be reached.
const MODEL_SUGGESTIONS: Record<string, readonly string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  xai: ['grok-4', 'grok-3', 'grok-3-mini'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
};

export function modelSuggestionsFor(provider: string): readonly string[] {
  return MODEL_SUGGESTIONS[provider] ?? [];
}

export function defaultModelFor(provider: string): string {
  return modelSuggestionsFor(provider)[0] ?? '';
}

// `AiCatalogModel` is assignable to this, so a picker takes the wire type without `chat-core` depending on `@zilar/api-contract`.
export interface CatalogModelView {
  readonly id: string;
  readonly name: string;
  readonly contextTokens: number;
  readonly inputPricePerMTok: number | null;
  readonly outputPricePerMTok: number | null;
  readonly toolCalls: boolean;
}

export function defaultCatalogModelId(models: readonly CatalogModelView[]): string {
  return (models.find((model) => model.toolCalls) ?? models[0])?.id ?? '';
}

// `0` means the catalog did not know the size.
export function formatContextTokens(tokens: number): string {
  if (tokens <= 0) {
    return '—';
  }
  if (tokens >= 1_000_000) {
    return `${trimNumber(tokens / 1_000_000)}M`;
  }
  if (tokens >= 1_000) {
    return `${trimNumber(tokens / 1_000)}K`;
  }
  return String(tokens);
}

export function formatModelPrices(input: number | null, output: number | null): string {
  if (input === null || output === null) {
    return 'Price unavailable';
  }
  return `$${formatUsd(input)} / $${formatUsd(output)} per M tokens`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function formatUsd(value: number): string {
  if (value === 0) {
    return '0';
  }
  if (value >= 0.0001) {
    return String(Number(value.toFixed(4)));
  }
  return value.toExponential(1);
}
